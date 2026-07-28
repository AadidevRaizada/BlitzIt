export const metadata = { title: 'Refund policy - The Circuit' };

export default function RefundsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-7">
      <h1 className="font-display text-4xl font-bold">Refund Policy</h1>
      <div className="text-muted-foreground mt-6 space-y-4 text-sm leading-6">
        <p>
          Refunds are handled by operators through the payment administration
          flow. The gateway refund is requested first, then payment,
          registration and prize-pool state are updated together.
        </p>
        <p>
          Payments already refunded, failed payments, or payments without a
          provider payment id cannot enter the refund flow.
        </p>
      </div>
    </main>
  );
}
