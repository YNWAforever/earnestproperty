import type {SyncCapability} from '../neon/admin-property-sync.types';
export function workflowCapability(source:string,env?:Record<string,string|undefined>):SyncCapability;
export function dispatchPropertySync(input:{source:string;operation:string;requestAsset:string|null;operationId:string},options?:{env?:Record<string,string|undefined>;fetchImpl?:typeof fetch}):Promise<{accepted:boolean;rejected:boolean}>;
