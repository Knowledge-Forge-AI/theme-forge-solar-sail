# First-party Theme Forge Solar Sail Nix source package derivation (TFSB71P3).
# Consumes clean public source inputs, filters out node_modules/dist/git metadata/private siblings,
# compiles TypeScript via buildNpmPackage, and installs immutable, cwd-independent Nix Node wrapper.
{ lib
, stdenv
, buildNpmPackage
, nodejs_22
, makeWrapper
, source
, npmDepsHash ? "sha256-XSYq8QTP3UT/2gz7E65DbT2uvZu1WvUsSEERUXOMXU0="
}:

let
  supportedSystems = [
    "aarch64-darwin"
    "aarch64-linux"
    "x86_64-linux"
  ];

  rawSrc = source;

  # Filter source to guarantee clean, deterministic, reproducible input:
  # Exclude node_modules, prior dist outputs, .git, caches, and Nix metadata.
  filteredSrc = lib.cleanSourceWith {
    src = rawSrc;
    name = "solar-sail-source";
    filter = path: type:
      let
        base = baseNameOf (toString path);
        rel = lib.removePrefix (toString rawSrc + "/") (toString path);
      in
        !(base == "node_modules"
          || base == "dist"
          || base == ".git"
          || base == "result"
          || base == ".cache"
          || base == ".DS_Store"
          || (rel == "nix" || lib.hasPrefix "nix/" rel)
          || rel == "flake.nix"
          || rel == "flake.lock");
  };

in
assert lib.elem stdenv.hostPlatform.system supportedSystems;
buildNpmPackage {
  pname = "theme-forge-solar-sail";
  version = (builtins.fromJSON (builtins.readFile (source + "/package.json"))).version;

  src = filteredSrc;

  nodejs = nodejs_22;
  inherit npmDepsHash;

  npmFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build";

  nativeBuildInputs = [ makeWrapper ];

  dontPatchShebangs = true;

  installPhase = ''
    runHook preInstall

    local pkgRoot="$out/lib/node_modules/@knowledge-forge-ai/theme-forge-solar-sail"
    mkdir -p "$pkgRoot" "$out/bin"

    # 1. Distributable compiled JavaScript and type definitions
    cp -r dist "$pkgRoot/dist"

    # 2. Executable entry script
    mkdir -p "$pkgRoot/bin"
    cp bin/tfss.js "$pkgRoot/bin/tfss.js"
    chmod 755 "$pkgRoot/bin/tfss.js"

    # 3. Examples
    cp -r examples "$pkgRoot/examples"

    # 4. Metadata and legal notices
    cp package.json "$pkgRoot/package.json"
    cp NOTICE "$pkgRoot/NOTICE"
    cp COMMERCIAL-LICENSE.md "$pkgRoot/COMMERCIAL-LICENSE.md"
    cp LICENSE "$pkgRoot/LICENSE"
    cp README.md "$pkgRoot/README.md"
    if [ -f CHANGELOG.md ]; then cp CHANGELOG.md "$pkgRoot/CHANGELOG.md"; fi

    # 5. Immutable, cwd-independent Nix Node wrapper for tfss
    makeWrapper ${nodejs_22}/bin/node "$out/bin/tfss" \
      --add-flags "$pkgRoot/bin/tfss.js" \
      --unset NODE_PATH --unset NODE_OPTIONS

    runHook postInstall
  '';

  passthru = {
    nodejs = nodejs_22;
  };

  meta = with lib; {
    description = "Tailwind v4 and shadcn/ui application theme compiler, library, and tfss CLI";
    homepage = "https://github.com/Knowledge-Forge-AI/theme-forge-solar-sail";
    license = licenses.agpl3Plus;
    platforms = supportedSystems;
    mainProgram = "tfss";
  };
}
