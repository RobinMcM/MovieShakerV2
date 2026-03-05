"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccordionContextValue {
    type: "single" | "multiple";
    collapsible: boolean;
    value: string | string[];
    onValueChange: (value: string | string[]) => void;
}

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

interface AccordionProps {
    type?: "single" | "multiple";
    collapsible?: boolean;
    defaultValue?: string | string[];
    value?: string | string[];
    onValueChange?: (value: string | string[]) => void;
    className?: string;
    children: React.ReactNode;
}

export function Accordion({
    type = "single",
    collapsible = true,
    defaultValue,
    value: controlledValue,
    onValueChange,
    className,
    children,
}: AccordionProps) {
    const [uncontrolledValue, setUncontrolledValue] = React.useState<string | string[]>(
        defaultValue ?? (type === "single" ? "" : [])
    );
    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : uncontrolledValue;
    const setValue = React.useCallback(
        (next: string | string[]) => {
            if (!isControlled) setUncontrolledValue(next);
            onValueChange?.(next);
        },
        [isControlled, onValueChange]
    );
    const ctx: AccordionContextValue = React.useMemo(
        () => ({ type, collapsible, value, onValueChange: setValue }),
        [type, collapsible, value, setValue]
    );
    return (
        <AccordionContext.Provider value={ctx}>
            <div className={cn("", className)}>{children}</div>
        </AccordionContext.Provider>
    );
}

interface AccordionItemContextValue {
    value: string;
    open: boolean;
    onOpen: () => void;
}

const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

export function AccordionItem({
    value: itemValue,
    className,
    children,
}: {
    value: string;
    className?: string;
    children: React.ReactNode;
}) {
    const accordion = React.useContext(AccordionContext);
    const open =
        accordion?.type === "single"
            ? (accordion.value as string) === itemValue
            : (accordion?.value as string[]).includes(itemValue);
    const onOpen = React.useCallback(() => {
        if (!accordion) return;
        if (accordion.type === "single") {
            const next = accordion.collapsible && open ? "" : itemValue;
            accordion.onValueChange(next);
        } else {
            const arr = (accordion.value as string[]) || [];
            const next = open ? arr.filter((v) => v !== itemValue) : [...arr, itemValue];
            accordion.onValueChange(next);
        }
    }, [accordion, itemValue, open]);
    const itemCtx = React.useMemo(() => ({ value: itemValue, open, onOpen }), [itemValue, open, onOpen]);
    return (
        <AccordionItemContext.Provider value={itemCtx}>
            <div className={cn("border-b border-border", className)} data-state={open ? "open" : "closed"}>
                {children}
            </div>
        </AccordionItemContext.Provider>
    );
}

export function AccordionTrigger({
    className,
    children,
    ...props
}: React.ComponentPropsWithoutRef<"button">) {
    const item = React.useContext(AccordionItemContext);
    if (!item) return null;
    return (
        <button
            type="button"
            className={cn(
                "flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
                className
            )}
            onClick={item.onOpen}
            data-state={item.open ? "open" : "closed"}
            {...props}
        >
            {children}
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
        </button>
    );
}

export function AccordionContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    const item = React.useContext(AccordionItemContext);
    if (!item) return null;
    if (!item.open) return null;
    return (
        <div className={cn("overflow-hidden text-sm", className)} data-state={item.open ? "open" : "closed"} {...props}>
            <div className="pb-4 pt-0">{children}</div>
        </div>
    );
}
