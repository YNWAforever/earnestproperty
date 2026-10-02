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
      export const commitWhatsappLinkChunk = async input => {
        window.commitCalls=(window.commitCalls||0)+1;
        if (!window.bulkCommit) throw Error('No live or synthetic commit expected in handoff tests');
        const operations=JSON.parse(localStorage.getItem('fixture-batch-ops')||'[]');
        const existing=operations.find(op=>op.chunkId===input.chunkId);
        if (existing) return existing;
        const result={batchId:input.batchId,chunkId:input.chunkId,state:'committed',rows:input.rows.map(row=>{
          const number=Number(row.input.publicListingNo?.slice(1));
          const outcome=number===48?'blocked':number>=49?'failed':number>=41?'reused':'created';
          const success=['created','reused'].includes(outcome);
          return {rowKey:row.rowKey,outcome,code:success?'synthetic-'+number:null,
            linkId:success?row.input.propertyId:null,version:success?1:null,
            reasonCode:success?null:number===48?'WA_LINK_VERSION_STALE':number===49?'WA_LINK_SCOPE_DENIED':'WA_LINK_STAFF_NOT_READY'};
        })};
        localStorage.setItem('fixture-batch-ops',JSON.stringify([...operations,result]));
        if (window.bulkLoseResponseOnce) { window.bulkLoseResponseOnce=false; throw Error('synthetic lost response'); }
        return result;
      };
      export const getWhatsappLinkBatchResult = async batchId => {
        window.batchReads=(window.batchReads||0)+1;
        if (window.bulkReadFail) throw Error('synthetic read outage');
        return {operations:JSON.parse(localStorage.getItem('fixture-batch-ops')||'[]').filter(op=>op.batchId===batchId)};
      };
      export const resolveWhatsappLinkImport = async ({offers,references}) => {
        window.importReads=(window.importReads||0)+1;
        if (!window.bulkImport) return {offers:[],references:[]};
        if (window.bulkImportDenied) throw Error('synthetic denied scope');
        return {offers:offers.filter(row=>row.publicListingNo!==window.missingOffer).map((row,index)=>({
          ...row,propertyId:'00000000-0000-4000-8000-'+String(index+1000).padStart(12,'0'),
          title:'合成樓盤碧堤半島',price:row.dealType==='sale'?6000000:18000,agentId:null,agentName:null,
        })),references:[...new Map(references.map(row=>[JSON.stringify([row.namespace,row.externalReference]),row])).values()].map((row,index)=>({id:'00000000-0000-4000-8000-'+String(index+2000).padStart(12,'0'),
          ...row,staffId:'00000000-0000-4000-8000-000000000099',valid:true}))};
      };
    `,
        }));
      },
    },
  ],
});
if (!built.success) throw new AggregateError(built.logs, "Browser fixture bundle failed");

await Bun.write(".audit/whatsapp-link-handoff-bundle.js", built.outputs[0]);
