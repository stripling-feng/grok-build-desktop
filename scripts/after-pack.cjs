const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const PELibrary = await import("pe-library");
  const ResEdit = await import("resedit");
  const executable = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  const icon = path.join(context.packager.projectDir, "build", "icon-rounded.ico");

  const binary = fs.readFileSync(executable);
  const pe = PELibrary.NtExecutable.from(binary, { ignoreCert: true });
  const resources = PELibrary.NtExecutableResource.from(pe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icon));
  const icons = iconFile.icons.map((item) => item.data);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);

  if (groups.length) {
    for (const group of groups) {
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        group.id,
        group.lang,
        icons,
      );
    }
  } else {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icons);
  }

  resources.outputResource(pe);
  const temporary = `${executable}.icon-tmp`;
  fs.writeFileSync(temporary, Buffer.from(pe.generate()));
  fs.renameSync(temporary, executable);
};
