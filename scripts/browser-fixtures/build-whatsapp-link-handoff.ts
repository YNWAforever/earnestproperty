const built = await Bun.build({
  entrypoints: ["scripts/browser-fixtures/whatsapp-link-handoff.tsx"],
  target: "browser",
  format: "esm",
  minify: false,
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "isolated-whatsapp-api",
      setup(build) {
        build.onResolve(
          { filter: /^@\/(auth|lib\/neon\/(whatsapp-enquiries|whatsapp-link-batches))$/ },
          (args) => ({ path: args.path, namespace: "synthetic-api" }),
        );
        build.onLoad({ filter: /.*/, namespace: "synthetic-api" }, () => ({
          loader: "js",
          contents: `
      export const withStaffAuthHeaders = async value => value;
      export const searchWhatsappLinkOffers = async () => [];
      export const previewWhatsappLinkBatch = async ({batchId,rows}) => {
        window.previewCalls=(window.previewCalls||0)+1;
        return {batchId,previewToken:crypto.randomUUID(),expiresAt:new Date(Date.now()+600000).toISOString(),rows:rows.map(row=>({rowKey:row.rowKey,decision:'create',reasons:[]})),counts:{create:rows.length,reuse:0,blocked:0}};
      };
      export const commitWhatsappLinkChunk = async () => { throw Error('No live or synthetic commit expected in handoff tests'); };
      export const getWhatsappLinkBatchResult = async () => ({operations:[]});
    `,
        }));
      },
    },
  ],
});
if (!built.success) throw new AggregateError(built.logs, "Browser fixture bundle failed");

await Bun.write(".audit/whatsapp-link-handoff-bundle.js", built.outputs[0]);
