export declare function actualManifest(version: string): Readonly<{
  name: 'opencode-webbridge';
  version: string;
  type: 'module';
  main: 'index.mjs';
  license: 'MIT';
  files: readonly ['index.mjs', 'LICENSE'];
  dependencies: Readonly<{ '@opencode/plugin': '2.0.29' }>;
  description: string;
}>;
export declare function sourceContract(text: string): Readonly<{
  entrySHA256: string; id: 'opencode.webbridge'; transportActive: false;
}>;
export declare function proveActualEntrypoint(options?: { native?: boolean }): Promise<object>;
