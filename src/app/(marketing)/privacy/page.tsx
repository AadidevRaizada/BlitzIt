export const metadata = { title: 'Privacy - The Circuit' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-7">
      <h1 className="font-display text-4xl font-bold">Privacy</h1>
      <div className="text-muted-foreground mt-6 space-y-4 text-sm leading-6">
        <p>
          The Circuit stores profile details, registrations, submissions,
          payments and notifications needed to run tournaments and show results.
        </p>
        <p>
          Signed-in users can download their own JSON data export from Settings.
          Public profiles only expose public placement and badge information.
        </p>
      </div>
    </main>
  );
}
