import { PageHead, Panel } from "@/components/pm";

// Where the middleware sends a member whose admin has switched off every area.
export default function NoAccessPage() {
  return (
    <div className="pm-page">
      <PageHead title="No areas yet" subtitle="Your account is set up, but no part of the CRM is switched on for you." />
      <Panel title="What to do">
        <p className="pm-muted">
          Ask an admin to open Settings, then Team, and choose the areas you should use. Reload this page once they have.
        </p>
      </Panel>
    </div>
  );
}
