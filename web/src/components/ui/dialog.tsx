import * as React from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
}

const DialogContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
}>({ open: false, onOpenChange: () => {} });

export const Dialog: React.FC<DialogProps> = ({ open = false, onOpenChange, children }) => {
    const [isOpen, setIsOpen] = React.useState(open);

    React.useEffect(() => {
        setIsOpen(open);
    }, [open]);

    const handleOpenChange = (newOpen: boolean) => {
        setIsOpen(newOpen);
        onOpenChange?.(newOpen);
    };

    return (
        <DialogContext.Provider value={{ open: isOpen, onOpenChange: handleOpenChange }}>
            {children}
        </DialogContext.Provider>
    );
};

export const DialogTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ className, onClick, asChild, children, ...props }, ref) => {
    const { onOpenChange } = React.useContext(DialogContext);

    const openDialog = (e: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        onOpenChange(true);
    };

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            ref,
            onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                (children as React.ReactElement<{ onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void }>).props.onClick?.(e);
                openDialog(e);
            },
        } as Record<string, unknown>);
    }

    return (
        <button
            ref={ref}
            className={cn(
                "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                className
            )}
            onClick={openDialog}
            {...props}
        >
            {children}
        </button>
    );
});
DialogTrigger.displayName = "DialogTrigger";

export const DialogContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
    const { open, onOpenChange } = React.useContext(DialogContext);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center sm:items-center">
            <div
                className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-all duration-100"
                onClick={() => onOpenChange(false)}
            />
            <div
                ref={ref}
                className={cn(
                    "fixed z-50 grid w-full gap-4 rounded-b-lg border bg-background p-6 shadow-lg sm:max-w-lg sm:rounded-lg",
                    className
                )}
                {...props}
            >
                {children}
                <button
                    className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
                    onClick={() => onOpenChange(false)}
                >
                    <span className="sr-only">Close</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                        <line x1="18" x2="6" y1="6" y2="18" />
                        <line x1="6" x2="18" y1="6" y2="18" />
                    </svg>
                </button>
            </div>
        </div>
    );
});
DialogContent.displayName = "DialogContent";

export const DialogHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
        {...props}
    />
);
DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
            className
        )}
        {...props}
    />
);
DialogFooter.displayName = "DialogFooter";

export const DialogTitle = React.forwardRef<
    HTMLHeadingElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
    <h3
        ref={ref}
        className={cn("text-lg font-semibold leading-none tracking-tight", className)}
        {...props}
    />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
    HTMLParagraphElement,
    React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
