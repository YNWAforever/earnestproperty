import type {StaffAccess} from '../neon/auth.server';
import type {SyncWorkspace,SyncOperationInput,SyncCapability} from '../neon/admin-property-sync.types';
import type {SyncRunSummary} from './sync-run-contract.mjs';
type Query=(sql:string,params?:unknown[])=>Promise<any[]>;
export function requireSyncRole(actor:Pick<StaffAccess,'staffId'|'roles'>,allowed?:string[]):void;
export const SYNC_HEALTH_COPY:Record<string,string>;
export function readSyncWorkspace(options:{query:Query;actor:StaffAccess;limit?:number;cursor?:{at:string;id:string}|null;now?:number;capabilities?:Record<string,SyncCapability>}):Promise<SyncWorkspace>;
export function requestSyncOperation(options:{query:Query;actor:StaffAccess;input:SyncOperationInput;capability:SyncCapability|null;dispatch:(input:any)=>Promise<{accepted:boolean;rejected?:boolean}>}):Promise<{runId:string;status:string}>;
export function recordSyncRun(options:{client:any;runId:string;summary:SyncRunSummary&{finishedAt?:string}}):Promise<void>;
