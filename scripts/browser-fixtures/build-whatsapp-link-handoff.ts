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
          {
            filter:
              /^@\/(auth|lib\/neon\/(whatsapp-enquiries|whatsapp-link-batches|whatsapp-link-import))$/,
          },
          (args) => ({ path: args.path, namespace: "synthetic-api" }),
        );
        build.onLoad({ filter: /.*/, namespace: "synthetic-api" }, () => ({
          loader: "js",
          contents: `
      export const withStaffAuthHeaders = async value => value;
      export const searchWhatsappLinkOffers = async () => [];
      export const previewWhatsappLinkBatch = async ({batchId,rows}) => {
        window.previewCalls=(window.previewCalls||0)+1;
        if (window.blockLastRow && !window.blockedRowKey && rows.length > 1)
          window.blockedRowKey = rows[rows.length-1].rowKey;
        const blocked = rows.some(row => row.rowKey === window.blockedRowKey);
        return {batchId,previewToken:crypto.randomUUID(),expiresAt:new Date(Date.now()+600000).toISOString(),
          rows:rows.map(row=>({rowKey:row.rowKey,decision:row.rowKey===window.blockedRowKey?'blocked':'create',
            reasons:row.rowKey===window.blockedRowKey?[{code:'WA_LINK_STAFF_NOT_READY',message:'同事設定需修正'}]:[]})),
          counts:{create:rows.length-(blocked?1:0),reuse:0,blocked:blocked?1:0}};
      };
      export const commitWhatsappLinkChunk = async () => { window.commitCalls=(window.commitCalls||0)+1; throw Error('No live or synthetic commit expected in handoff tests'); };
      export const getWhatsappLinkBatchResult = async () => ({operations:[]});
      export const resolveWhatsappLinkImport = async () => ({offers:[],references:[]});
    `,
        }));
      },
    },
  ],
});
if (!built.success) throw new AggregateError(built.logs, "Browser fixture bundle failed");

await Bun.write(".audit/whatsapp-link-handoff-bundle.js", built.outputs[0]);
