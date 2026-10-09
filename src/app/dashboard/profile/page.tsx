"use client";
import { PageHeader } from "@/components/pm";
import { ProfilePanel } from "@/components/settings/ProfilePanel";

// "My profile" on its own, for members whose areas exclude Settings (the
// sidebar name links here for them). Everyone else uses Settings → My profile.
export default function ProfilePage() {
  return (
    <>
      <PageHeader crumb="Settings" title="My profile" summary="Your name and photo, and how the CRM alerts you." />
      <div className="pm2-body">
        <ProfilePanel />
      </div>
    </>
  );
}
