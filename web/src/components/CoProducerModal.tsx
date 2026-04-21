"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface CoProducerModalProps {
    open: boolean;
    onClose: () => void;
}

export function CoProducerModal({ open, onClose }: CoProducerModalProps) {
    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogTitle className="text-base font-semibold">Unlock CoProducer</DialogTitle>
                <div className="grid grid-cols-2 gap-3 mt-1">
                    <div className="rounded-lg border p-4 space-y-2 opacity-60">
                        <p className="text-sm font-semibold">Buy Credits</p>
                        <p className="text-xs text-muted-foreground">Pay as you go</p>
                        <span className="inline-block text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground">
                            coming soon
                        </span>
                    </div>
                    <div className="rounded-lg border p-4 space-y-2 opacity-60">
                        <p className="text-sm font-semibold">Subscribe</p>
                        <p className="text-xs text-muted-foreground">Full access</p>
                        <span className="inline-block text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground">
                            coming soon
                        </span>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
