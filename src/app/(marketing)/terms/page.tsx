export const metadata = { title: 'Terms - The Circuit' };

export default function TermsPage() {
  return (
    <PolicyPage title="Terms">
      <p>
        By entering a tournament, you agree to follow the published rules,
        submit only work you are allowed to share, and accept that scoring,
        brackets and placements are based on persisted platform records.
      </p>
      <p>
        The current terms version is recorded when you accept entry terms. Paid
        tournament entry is blocked until that acceptance is stored.
      </p>
    </PolicyPage>
  );
}

function PolicyPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-7">
      <h1 className="font-pixel text-4xl font-bold uppercase">{title}</h1>
      <div className="text-muted-foreground mt-6 space-y-4 text-sm leading-6">
        {children}
      </div>
    </main>
  );
}
