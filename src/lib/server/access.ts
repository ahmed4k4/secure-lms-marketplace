export type AccessContext = { authenticated: boolean; accountActive: boolean; isOwnerOrAdmin: boolean; isPreview: boolean; hasActiveEntitlement: boolean; hasEnrollment: boolean };
export function canPlayLesson(context: AccessContext): boolean {
 if (!context.authenticated || !context.accountActive) return false;
 if (context.isOwnerOrAdmin || context.isPreview) return true;
 return context.hasActiveEntitlement || context.hasEnrollment;
}
