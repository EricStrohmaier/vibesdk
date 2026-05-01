{ pkgs }: {
  deps = [
    pkgs.nodejs_22
    pkgs.bun
    pkgs.python3
    pkgs.git
    pkgs.openssh
  ];
}
