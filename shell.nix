{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  name = "plexo-dev-shell";
  packages = with pkgs; [
    nodejs_22
    git
    python3
    electron
  ];

  shellHook = ''
    export ELECTRON_EXEC_PATH="${pkgs.electron}/bin/electron"
  '';
}
