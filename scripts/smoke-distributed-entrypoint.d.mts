export declare function actualManifest(version: string, runtimeFiles?: readonly string[]): Readonly<{
  name: 'opencode-webbridge';
  version: string;
  type: 'module';
  main: 'index.mjs';
  license: 'MIT';
  files: readonly string[];
  dependencies: Readonly<{ '@opencode/plugin': '2.0.29' }>;
  description: string;
}>;
export declare function reviewNativeGraph(files: ReadonlyMap<string, string>): Readonly<{
  graphFiles: number; nativeRegistrationShipped: true; nativeAnchorShipped: true;
}>;
export declare function sourceContract(text: string): Readonly<{
  entrySHA256: string; id: 'opencode.webbridge'; transportActive: false;
}>;
export declare function proveActualEntrypoint(options?: { native?: boolean,
  localFactory?: unknown }): Promise<object>;
