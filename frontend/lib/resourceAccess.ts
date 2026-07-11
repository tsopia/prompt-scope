// Mirrors the backend policy in backend/services/authz.assert_resource_manager:
// a ModelProvider/ModelPricing row can only be edited or deleted by its
// creator or a project owner. Legacy rows (created_by null) fall through to
// owner-only, since there is no creator to match against.
export function canManageResource(
  createdBy: string | null,
  isOwner: boolean,
  userId: string | undefined
): boolean {
  return isOwner || (!!userId && createdBy === userId);
}
