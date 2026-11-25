export function resolveCreativeImage(workspace,creative){
  return creative?.image||workspace?.assets?.find(asset=>asset.id===creative?.imageRef)?.data||'';
}
