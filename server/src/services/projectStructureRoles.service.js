const ROLE_RULES = [
  ["test", /(^|\/)(__tests__|tests?|e2e|cypress)\/|\.(test|spec)\.[^.]+$/i],
  [
    "config",
    /(^|\/)(config|configs)\/|(\.config|\.rc)\.[^.]+$|(^|\/)(eslint|vite|tailwind|playwright|jest|vitest|webpack|rollup|babel|postcss|prettier|next|nuxt|tsconfig|jsconfig)(\.config)?\.[^.]+$/i,
  ],
  [
    "route",
    /(^|\/)(routes?|router)\/|(^|\/)(server\/)?(index|server|app)\.[^.]+$/i,
  ],
  ["controller", /(^|\/)(controllers?)\//i],
  ["service", /(^|\/)(services?)\//i],
  ["middleware", /(^|\/)(middlewares?)\//i],
  ["model", /(^|\/)(models?|repositories?|entities|schemas?|db|prisma)\//i],
  ["validator", /(^|\/)(validators?)\//i],
  ["utility", /(^|\/)(utils?|helpers?|lib)\//i],
  ["page", /(^|\/)(pages?|views?|screens?)\//i],
  ["hook", /(^|\/)hooks?\/|(^|\/)use[A-Z][^/]*\.[^.]+$/],
  ["context", /(^|\/)(contexts?|providers?|stores?)\//i],
  ["layout", /(^|\/)(layouts?)\//i],
  ["style", /\.(css|scss|sass|less)$/i],
  ["component", /(^|\/)(components?)\/|(^|\/)(App|main)\.[^.]+$/i],
];

export const classifyProjectStructureRole = (relativePath) => {
  const path = relativePath.replace(/\\/g, "/");
  const match = ROLE_RULES.find(([, pattern]) => pattern.test(path));
  if (!match) return { role: "unknown", evidence: [], confidence: "none" };
  return { role: match[0], evidence: [`path:${match[1]}`], confidence: "high" };
};

export const aggregateFolderRoles = (files) => {
  const roles = new Map();
  for (const file of files) {
    const parts = file.relativePath.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const folder = parts.slice(0, index).join("/");
      if (!roles.has(folder)) roles.set(folder, new Map());
      const counts = roles.get(folder);
      counts.set(file.role, (counts.get(file.role) || 0) + 1);
    }
  }
  return roles;
};

export const classifyProjectStructureDomain = (
  relativePath,
  role = "unknown",
) => {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] || "";
  const baseName = fileName.replace(/\.[^.]+$/, "");

  const moduleFolderIdx = parts.findIndex((p) =>
    /^(modules?|features?|domains?)$/i.test(p),
  );
  if (moduleFolderIdx !== -1 && parts[moduleFolderIdx + 1]) {
    const domainPart = parts[moduleFolderIdx + 1];
    return (
      domainPart.charAt(0).toUpperCase() + domainPart.slice(1).toLowerCase()
    );
  }

  const technicalFolders = new Set([
    "src",
    "server",
    "client",
    "app",
    "lib",
    "common",
    "shared",
    "controllers",
    "routes",
    "services",
    "models",
    "middlewares",
    "validators",
    "components",
    "pages",
    "views",
    "screens",
    "hooks",
    "contexts",
    "providers",
    "stores",
    "utils",
    "helpers",
    "config",
    "configs",
    "test",
    "tests",
    "__tests__",
    "styles",
  ]);

  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i].toLowerCase();
    if (!technicalFolders.has(seg) && seg.length > 2) {
      return seg.charAt(0).toUpperCase() + seg.slice(1);
    }
  }

  let cleanedBase = baseName
    .replace(
      /\.(controller|route|service|model|middleware|validator|helper|util|slice|context|test|spec|config)$/i,
      "",
    )
    .replace(
      /(Controller|Route|Service|Model|Middleware|Validator|Helper|Util|Slice|Context|Page|View|Screen)$/i,
      "",
    );

  if (
    !cleanedBase ||
    /^(index|app|main|server|setup|config)$/i.test(cleanedBase)
  ) {
    return "Core";
  }

  const match = cleanedBase.match(/^[A-Z][a-z]+/);
  if (match && match[0].length >= 3) {
    return match[0];
  }

  return (
    cleanedBase.charAt(0).toUpperCase() + cleanedBase.slice(1).toLowerCase()
  );
};
