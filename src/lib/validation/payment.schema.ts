import { z } from 'zod';

export const createPassOrderSchema = z.object({
  tournamentId: z.string().uuid(),
});

export type CreatePassOrderInput = z.infer<typeof createPassOrderSchema>;

export const confirmCheckoutSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().regex(/^[a-f0-9]{64}$/i),
});

export type ConfirmCheckoutActionInput = z.infer<typeof confirmCheckoutSchema>;

const razorpayEntitySchema = z.record(z.unknown());

export const razorpayWebhookSchema = z.object({
  id: z.string().min(1).optional(),
  event: z.string().min(1),
  payload: z
    .object({
      payment: z.object({ entity: razorpayEntitySchema }).optional(),
      refund: z.object({ entity: razorpayEntitySchema }).optional(),
    })
    .optional(),
});
