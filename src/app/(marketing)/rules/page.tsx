import { CheckCircle2, Scale, ShieldCheck, Timer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Section } from '@/components/ui/section';

export const metadata = { title: 'Rules - The Circuit' };

const score = [
  {
    label: 'Functional',
    value: '60%',
    body: 'Hidden tests and product behavior carry the largest share.',
  },
  {
    label: 'Performance',
    value: '15%',
    body: 'The deployed app is probed as a running black box.',
  },
  {
    label: 'Security',
    value: '10%',
    body: 'Reliability and abuse resistance are checked before style points.',
  },
  {
    label: 'AI Review',
    value: '15%',
    body: 'This applies only from the semi-finals onward.',
  },
];

export default function RulesPage() {
  return (
    <main>
      <Section className="bg-surface-deep">
        <p className="text-primary text-sm font-bold">Competition rules</p>
        <DisplayHeading as="h1" className="mt-3">
          Measured first. Reviewed when it matters.
        </DisplayHeading>
        <p className="text-muted-foreground mt-5 max-w-3xl text-lg leading-8">
          The Circuit never executes competitor code. Each entry is a public
          GitHub repository plus a live deployment URL. The platform probes the
          running product, reads the repository as text, and advances the
          bracket from those results.
        </p>
      </Section>

      <Section className="bg-background">
        <div className="grid gap-4 md:grid-cols-4">
          {score.map((item) => (
            <Card key={item.label} surface="broadcast" className="p-5">
              <p className="text-primary text-4xl font-extrabold tabular-nums">
                {item.value}
              </p>
              <h2 className="mt-6 font-bold">{item.label}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {item.body}
              </p>
            </Card>
          ))}
        </div>
      </Section>

      <Section className="bg-surface-raised">
        <div className="grid gap-5 lg:grid-cols-3">
          <Rule
            icon={<Timer className="size-6" aria-hidden />}
            title="The clock is real"
            body="Rounds open and close at server-written instants. The UI countdown is a display aid; late submissions are refused by the server."
          />
          <Rule
            icon={<ShieldCheck className="size-6" aria-hidden />}
            title="Problems reveal together"
            body="A sealed round stays sealed until it opens. Public and competitor bracket surfaces do not reveal future problem statements."
          />
          <Rule
            icon={<Scale className="size-6" aria-hidden />}
            title="AI starts in the semi-finals"
            body="Qualifiers through quarter-finals are scored on deterministic measurements only. The 15% AI review dimension applies from the semi-finals onward."
          />
        </div>
      </Section>

      <Section className="bg-background">
        <Card surface="broadcast" className="p-6">
          <CheckCircle2 className="text-primary size-7" aria-hidden />
          <h2 className="mt-5 text-2xl font-extrabold tracking-[-0.03em]">
            What competitors can expect
          </h2>
          <ul className="text-muted-foreground mt-5 grid gap-3 text-sm leading-6 md:grid-cols-2">
            <li>Submit a repository URL and deployment URL before deadline.</li>
            <li>Replace a submission while the window remains open.</li>
            <li>See the dimensions that decide the current round.</li>
            <li>Watch the bracket update when evaluations and ties resolve.</li>
          </ul>
        </Card>
      </Section>
    </main>
  );
}

function Rule({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card surface="broadcast" className="p-5">
      <div className="text-primary">{icon}</div>
      <h2 className="mt-5 text-xl font-bold">{title}</h2>
      <p className="text-muted-foreground mt-3 text-sm leading-6">{body}</p>
    </Card>
  );
}
