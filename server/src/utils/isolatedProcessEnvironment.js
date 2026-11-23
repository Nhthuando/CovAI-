const operatingSystemNames=new Set(['PATH','PATHEXT','COMSPEC','SYSTEMROOT','WINDIR','SYSTEMDRIVE','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','LANG','LC_ALL','TZ']);

// Inherited application credentials belong to CovAI, not to the imported AUT.
// Keep OS/tool discovery working and pass project test values explicitly.
// This is environment separation; it does not sandbox host filesystem access.
export const isolatedProcessEnvironment = (overrides={},host=process.env) => ({
    ...Object.fromEntries(Object.entries(host).filter(([name])=>operatingSystemNames.has(name.toUpperCase()))),
    NODE_PATH:'',NODE_OPTIONS:'',...overrides,
});
