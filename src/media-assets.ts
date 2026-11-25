import type {Workspace, Creative} from './domain.js';
export function resolveCreativeImage(workspace: Workspace | null,creative: Partial<Creative> | null): string{
  return creative?.image||workspace?.assets?.find(asset=>asset.id===creative?.imageRef)?.data||'';
}
