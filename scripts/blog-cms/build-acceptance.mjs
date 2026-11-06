import { recordSuccessfulBuild } from "./acceptance-identity.mjs";
const receipt = await recordSuccessfulBuild();
console.log("BUILD_RECEIPT " + JSON.stringify(receipt));
