"""Build an offline VSIX using only the Python standard library."""

import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


VSIX_NS = "http://schemas.microsoft.com/developer/vsx-schema/2011"
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"


def vsix_manifest(package):
    ET.register_namespace("", VSIX_NS)

    def child(parent, name, attributes=None, text=None):
        element = ET.SubElement(parent, f"{{{VSIX_NS}}}{name}", attributes or {})
        element.text = text
        return element

    root = ET.Element(f"{{{VSIX_NS}}}PackageManifest", {"Version": "2.0.0"})
    metadata = child(root, "Metadata")
    child(metadata, "Identity", {
        "Language": "ja-JP",
        "Id": package["name"],
        "Version": package["version"],
        "Publisher": package["publisher"],
    })
    child(metadata, "DisplayName", text=package["displayName"])
    child(metadata, "Description", {
        "{http://www.w3.org/XML/1998/namespace}space": "preserve",
    }, package["description"])
    child(metadata, "Categories", text=",".join(package.get("categories", [])))
    properties = child(metadata, "Properties")
    child(properties, "Property", {
        "Id": "Microsoft.VisualStudio.Code.Engine",
        "Value": package["engines"]["vscode"],
    })
    installation = child(root, "Installation")
    child(installation, "InstallationTarget", {"Id": "Microsoft.VisualStudio.Code"})
    child(root, "Dependencies")
    assets = child(root, "Assets")
    child(assets, "Asset", {
        "Type": "Microsoft.VisualStudio.Code.Manifest",
        "Path": "extension/package.json",
        "Addressable": "true",
    })
    child(assets, "Asset", {
        "Type": "Microsoft.VisualStudio.Services.Content.Details",
        "Path": "extension/README.md",
        "Addressable": "true",
    })
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def content_types():
    ET.register_namespace("", CONTENT_NS)
    root = ET.Element(f"{{{CONTENT_NS}}}Types")
    for extension, mime in (
        ("json", "application/json"),
        ("js", "application/javascript"),
        ("md", "text/markdown"),
        ("vsixmanifest", "text/xml"),
    ):
        ET.SubElement(root, f"{{{CONTENT_NS}}}Default", {
            "Extension": extension, "ContentType": mime,
        })
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def build():
    extension_root = Path(__file__).resolve().parent
    package = json.loads((extension_root / "package.json").read_text(encoding="utf-8"))
    # Explicit runtime allowlist keeps tests, build helpers and dist out of the VSIX.
    runtime_files = [extension_root / "package.json", extension_root / "README.md"]
    runtime_files.extend(sorted((extension_root / "src").rglob("*.js")))
    members = {
        "[Content_Types].xml": content_types(),
        "extension.vsixmanifest": vsix_manifest(package),
    }
    for file in runtime_files:
        members[f"extension/{file.relative_to(extension_root).as_posix()}"] = file.read_bytes()

    output = extension_root / "dist" / f"{package['name']}-{package['version']}.vsix"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, contents in members.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, contents)
    print(f"Created: {output.relative_to(extension_root.parent).as_posix()}")


if __name__ == "__main__":
    build()
