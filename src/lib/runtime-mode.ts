export const runtimeModes = ['local-import', 'pages-static'] as const;

export type RuntimeMode = (typeof runtimeModes)[number];

const requestedRuntimeMode = import.meta.env.PUBLIC_RUNTIME_MODE;

export const runtimeMode: RuntimeMode = runtimeModes.includes(requestedRuntimeMode as RuntimeMode)
  ? (requestedRuntimeMode as RuntimeMode)
  : 'pages-static';

export function isLocalImportMode() {
  return runtimeMode === 'local-import';
}

export function isPagesStaticMode() {
  return runtimeMode === 'pages-static';
}
