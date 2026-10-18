/** Type surface for the D01/D02 pinned official Desktop probe.
 *  The probe is executed by `npm run check:d01d02` and imported read-only by
 *  `test/desktop-levels.test.ts` to assert its pins and its verdict shape. */
export declare const TAG: string;
export declare const FILES: Readonly<Record<string, string>>;
export declare function loadOfficial(sourceRoot?: string): Promise<Record<string, string>>;
export declare function proveOfficialPublicApi(source: Record<string, string>): Promise<{
  readonly status: string;
  readonly tag: string;
  readonly packagedManagerCalls: number;
  readonly builtins: number;
  readonly serverPluginRenderer: boolean;
  readonly nativeDesktopExecuted: boolean;
}>;
