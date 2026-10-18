declare const plugin: {
  setup(context: any): Promise<(() => Promise<void>) | undefined>;
};
export default plugin;
