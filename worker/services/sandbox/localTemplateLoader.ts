import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TemplateInfo, TemplateDetails, TemplateFile, TemplateListResponse, TemplateDetailsResponse } from './sandboxTypes';
import { FileTreeBuilder } from './fileTreeBuilder';

const EXCLUDED_DIRS = new Set([
	'node_modules', '.git', '.github', 'dist', '.wrangler', '.cache', '.next', 'build', 'out', 'coverage',
]);

const EXCLUDED_FILES = new Set([
	'.DS_Store', 'Thumbs.db',
]);

interface TemplatesLocation {
	repoRoot: string;
	definitionsDir: string;
}

function findTemplatesDir(): TemplatesLocation | null {
	const candidates = [
		path.resolve('.local-templates'),
		path.resolve('templates'),
		path.resolve('../vibesdk-templates'),
	];
	for (const candidate of candidates) {
		if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
			continue;
		}
		const defsDir = path.join(candidate, 'definitions');
		if (fs.existsSync(defsDir) && fs.statSync(defsDir).isDirectory()) {
			return { repoRoot: candidate, definitionsDir: defsDir };
		}
		return { repoRoot: candidate, definitionsDir: candidate };
	}
	return null;
}

function readDirRecursive(dir: string, basePath: string = ''): TemplateFile[] {
	const files: TemplateFile[] = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (EXCLUDED_DIRS.has(entry.name) || EXCLUDED_FILES.has(entry.name)) {
			continue;
		}

		const fullPath = path.join(dir, entry.name);
		const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			files.push(...readDirRecursive(fullPath, relativePath));
		} else if (entry.isFile()) {
			try {
				const contents = fs.readFileSync(fullPath, 'utf-8');
				files.push({ filePath: relativePath, fileContents: contents });
			} catch {
				// binary file -- encode as base64
				const buffer = fs.readFileSync(fullPath);
				files.push({ filePath: relativePath, fileContents: `base64:${buffer.toString('base64')}` });
			}
		}
	}

	return files;
}

function parseTemplateInfo(templateDir: string, templateName: string): TemplateInfo | null {
	const packageJsonPath = path.join(templateDir, 'package.json');
	if (!fs.existsSync(packageJsonPath)) {
		return null;
	}

	let description = { selection: templateName, usage: '' };
	let language: string | undefined;
	let frameworks: string[] | undefined;
	let projectType: 'app' | 'workflow' | 'presentation' | 'general' = 'app';
	let renderMode: 'sandbox' | 'browser' | undefined;
	let slideDirectory: string | undefined;
	let disabled = false;

	const metadataPath = path.join(templateDir, '.template_metadata.json');
	if (fs.existsSync(metadataPath)) {
		try {
			const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
			if (meta.description) description = meta.description;
			if (meta.language) language = meta.language;
			if (meta.frameworks) frameworks = meta.frameworks;
			if (meta.projectType) projectType = meta.projectType;
			if (meta.renderMode) renderMode = meta.renderMode;
			if (meta.slideDirectory) slideDirectory = meta.slideDirectory;
			if (meta.disabled !== undefined) disabled = meta.disabled;
		} catch {
			// metadata file exists but is invalid -- continue with defaults
		}
	}

	const catalogInfoPath = path.join(templateDir, '.catalog_info.json');
	if (fs.existsSync(catalogInfoPath)) {
		try {
			const info = JSON.parse(fs.readFileSync(catalogInfoPath, 'utf-8'));
			if (info.description) description = info.description;
			if (info.language) language = info.language;
			if (info.frameworks) frameworks = info.frameworks;
			if (info.projectType) projectType = info.projectType;
			if (info.renderMode) renderMode = info.renderMode;
			if (info.slideDirectory) slideDirectory = info.slideDirectory;
			if (info.disabled !== undefined) disabled = info.disabled;
		} catch {
			// catalog info file exists but is invalid
		}
	}

	return {
		name: templateName,
		language,
		frameworks,
		projectType,
		description,
		renderMode,
		slideDirectory,
		disabled,
	};
}

let cachedLocation: TemplatesLocation | null | undefined;
let cachedCatalog: TemplateListResponse | null = null;
const detailsCache: Record<string, TemplateDetails> = {};

function getLocation(): TemplatesLocation | null {
	if (cachedLocation === undefined) {
		cachedLocation = findTemplatesDir();
	}
	return cachedLocation;
}

export function isLocalTemplatesAvailable(): boolean {
	return getLocation() !== null;
}

export function localListTemplates(): TemplateListResponse {
	if (cachedCatalog) return cachedCatalog;

	const location = getLocation();
	if (!location) {
		return { success: false, templates: [], count: 0, error: 'No local templates directory found' };
	}

	const catalogPath = path.join(location.repoRoot, 'template_catalog.json');
	if (fs.existsSync(catalogPath)) {
		try {
			const templates = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as TemplateInfo[];
			const filtered = templates.filter(t => !t.name.includes('next'));
			cachedCatalog = { success: true, templates: filtered, count: filtered.length };
			return cachedCatalog;
		} catch {
			// fall through to directory scanning
		}
	}

	const entries = fs.readdirSync(location.definitionsDir, { withFileTypes: true });
	const templates: TemplateInfo[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') {
			continue;
		}
		if (entry.name.includes('next')) continue;

		const templateDir = path.join(location.definitionsDir, entry.name);
		const info = parseTemplateInfo(templateDir, entry.name);
		if (info) {
			templates.push(info);
		}
	}

	cachedCatalog = { success: true, templates, count: templates.length };
	return cachedCatalog;
}

export function localGetTemplateDetails(templateName: string): TemplateDetailsResponse {
	if (detailsCache[templateName]) {
		return { success: true, templateDetails: detailsCache[templateName] };
	}

	const location = getLocation();
	if (!location) {
		return { success: false, error: 'No local templates directory found' };
	}

	const templateDir = path.join(location.definitionsDir, templateName);
	if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
		return { success: false, error: `Template '${templateName}' not found locally` };
	}

	const allFilesList = readDirRecursive(templateDir);

	const fileTree = FileTreeBuilder.buildFromTemplateFiles(allFilesList, { rootPath: '.' });

	const packageJsonFile = allFilesList.find(f => f.filePath === 'package.json');
	const packageJson = packageJsonFile ? JSON.parse(packageJsonFile.fileContents) : null;
	const deps = packageJson?.dependencies || {};

	const dontTouchFile = allFilesList.find(f => f.filePath === '.donttouch_files.json');
	const dontTouchFiles: string[] = dontTouchFile ? JSON.parse(dontTouchFile.fileContents) : [];

	const redactedFile = allFilesList.find(f => f.filePath === '.redacted_files.json');
	const redactedFiles: string[] = redactedFile ? JSON.parse(redactedFile.fileContents) : [];

	const importantFile = allFilesList.find(f => f.filePath === '.important_files.json');
	const importantFiles: string[] = importantFile ? JSON.parse(importantFile.fileContents) : [];

	const catalogResponse = localListTemplates();
	const catalogInfo = catalogResponse.success
		? catalogResponse.templates.find(t => t.name === templateName)
		: null;

	const filteredFiles = allFilesList.filter(f =>
		!f.filePath.startsWith('.') ||
		(!f.filePath.endsWith('.json') && !f.filePath.startsWith('.git'))
	);
	const filesMap: Record<string, string> = {};
	for (const file of filteredFiles) {
		filesMap[file.filePath] = file.fileContents;
	}

	const templateDetails: TemplateDetails = {
		name: templateName,
		description: catalogInfo?.description || { selection: '', usage: '' },
		disabled: catalogInfo?.disabled ?? false,
		fileTree,
		allFiles: filesMap,
		language: catalogInfo?.language,
		deps,
		importantFiles,
		dontTouchFiles,
		redactedFiles,
		projectType: catalogInfo?.projectType || 'app',
		frameworks: catalogInfo?.frameworks || [],
		renderMode: catalogInfo?.renderMode,
		slideDirectory: catalogInfo?.slideDirectory,
	};

	detailsCache[templateName] = templateDetails;
	return { success: true, templateDetails };
}
