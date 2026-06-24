import { useState } from 'react';

// Encourages the user to connect Google Drive. The actual OAuth flow is layered
// in later; for now this is the persuasive nudge described in the plan.
export default function DriveBanner() {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('dn_drive_banner_dismissed') === '1'
  );
  if (dismissed) return null;

  function dismiss() {
    sessionStorage.setItem('dn_drive_banner_dismissed', '1');
    setDismissed(true);
  }

  return (
    <div className="drive-banner no-print">
      <p>
        🗂️ <strong>Connect Google Drive</strong> to store unlimited recipe photos
        and save your whole collection as a printable <strong>recipe book</strong>.
        Without it, photos are capped at 1&nbsp;MB each.
      </p>
      <a className="btn" href="/api/drive/connect">Connect Drive</a>
      <button className="secondary" onClick={dismiss}>Later</button>
    </div>
  );
}
