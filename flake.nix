{
  description = "Theme Forge Solar Sail - Tailwind v4 and shadcn/ui application theme compiler, library, and tfss CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      # Public-composition recipe: remapped to ./nix/package.nix at public repository root.
      packagePath = ./nix/package.nix;
      toolsDir = ./tools;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          solar = pkgs.callPackage packagePath {
            source = self;
          };
        in
        {
          default = solar;
          theme-forge-solar-sail = solar;
          solar-sail = solar;
        });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/tfss";
        };
        tfss = {
          type = "app";
          program = "${self.packages.${system}.theme-forge-solar-sail}/bin/tfss";
        };
      });

      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          solar = self.packages.${system}.theme-forge-solar-sail;
          installedPkgRoot = "${solar}/lib/node_modules/@knowledge-forge-ai/theme-forge-solar-sail";
        in
        {
          theme-forge-solar-sail = pkgs.runCommand "theme-forge-solar-sail-check" {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            WORK_DIR=$(mktemp -d)
            ${pkgs.nodejs_22}/bin/node "${toolsDir}/qualify-installed.mjs" \
                --package-root "${installedPkgRoot}" \
                --node "${pkgs.nodejs_22}/bin/node" \
                --cli "${solar}/bin/tfss" \
                --work-dir "$WORK_DIR"
            mkdir -p $out
            touch $out/ok
          '';
          solar-sail = self.checks.${system}.theme-forge-solar-sail;

        });
    };
}
