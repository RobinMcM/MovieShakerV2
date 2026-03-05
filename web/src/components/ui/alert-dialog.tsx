"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface AlertDialogContextValue {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const AlertDialogContext = React.createContext<AlertDialogContextValue | null>(null);

export function AlertDialog({
    open,
    onOpenChange,
    children,
}: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
}) {
    return (
        <AlertDialogContext.Provider value={{ open: !!open, onOpenChange: onOpenChange ?? (() => {}) }}>
            {children}
        </AlertDialogContext.Provider>
    );
}

export function AlertDialogContent({
    className,
    children,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    const ctx = React.useContext(AlertDialogContext);
    if (!ctx?.open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
            <div
                className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
                onClick={() => ctx.onOpenChange(false)}
                aria-hidden
            />
            <div
                role="alertdialog"
                className={cn(
                    "relative z-50 grid w-full gap-4 rounded-b-lg border bg-background p-6 shadow-lg sm:max-w-lg sm:rounded-lg",
                    className
                )}
                onClick={(e) => e.stopPropagation()}
                {...props}
            >
                {children}
            </div>
        </div>
    );
}

export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2", className)}
            {...props}
        />
    );
}

export function AlertDialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
    return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function AlertDialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
    return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function AlertDialogAction({
    className,
    onClick,
    disabled,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const ctx = React.useContext(AlertDialogContext);
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        ctx?.onOpenChange(false);
    };
    return (
        <button
            type="button"
            className={cn(
                "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                className
            )}
            onClick={handleClick}
            disabled={disabled}
            {...props}
        />
    );
}

export function AlertDialogCancel({
    className,
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const ctx = React.useContext(AlertDialogContext);
    return (
        <button
            type="button"
            className={cn(
                "inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                className
            )}
            onClick={() => ctx?.onOpenChange(false)}
            {...props}
        />
    );
}
