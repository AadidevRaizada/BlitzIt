'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Form primitives — design-system §9.
 *
 * Every control is label-bound (`htmlFor`/`id`), describes its hint and error
 * through `aria-describedby`, and marks invalidity with `aria-invalid` rather
 * than colour alone. The focus ring is never removed.
 *
 * These are deliberately thin wrappers over native elements: native inputs give
 * us keyboard behaviour, form association and validation messaging for free,
 * which a bespoke widget would have to re-earn.
 */

const controlBase = cn(
  'border-input bg-background w-full rounded-md border px-3 text-sm',
  'placeholder:text-muted-foreground',
  'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-[invalid=true]:border-destructive',
);

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string }) => React.ReactNode;
}

function FieldShell({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? (
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ id, describedBy })}
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type BaseProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
};

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: BaseProps & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      className={className}
    >
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(controlBase, 'h-9')}
          {...props}
        />
      )}
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  rows = 4,
  ...props
}: BaseProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      className={className}
    >
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(controlBase, 'py-2 leading-relaxed')}
          {...props}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  options,
  ...props
}: BaseProps &
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    options: ReadonlyArray<{ value: string; label: string }>;
  }) {
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={props.required}
      className={className}
    >
      {({ id, describedBy }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(controlBase, 'h-9')}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}

export function CheckboxField({
  label,
  hint,
  className,
  ...props
}: BaseProps & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hintId}
        className="border-input text-primary focus-visible:ring-ring mt-0.5 size-4 rounded-sm border focus-visible:ring-2 focus-visible:outline-none"
        {...props}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint ? (
          <p id={hintId} className="text-muted-foreground text-xs">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Inline form-level error, distinct from per-field errors. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
    >
      {message}
    </p>
  );
}
