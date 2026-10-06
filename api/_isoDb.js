// Picks the ISO data adapter. Leading underscore = shared module, not a Vercel route.
// Interface (plan §4.1a) — both adapters implement every method the same way:
//   get(table,id), list(table,{scope,where,order,limit}), insertNumbered(table,kind,scope,row,activity),
//   insert(table,row,activity), update(table,id,patch,expectedVersion,activity),
//   transition(table,id,column,from,to,activity), verifyAction(id,result,notes,expectedVersion,activity),
//   reopenAction(id,reasonCode,reasonText,expectedVersion,activity), log(activity), counterNext(scope),
//   importApply(runId,diff), storageSignedUpload(path), storageSignedDownload(path,name),
//   storageHead(path), storagePut(path,bytes,type) (offline and import only), storageRemove(path).
const { isoOfflineMode } = require('./_isoAuth');

function getAdapter() {
  if (isoOfflineMode()) return require('./_isoDbOffline');
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('ISO: Supabase not configured (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing)');
  }
  return require('./_isoDbSupabase');
}

module.exports = { getAdapter };
