import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  onConfirm,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
  busy?: boolean;
  error?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? "Saving…" : action}
        </Button>
      </div>
    </Dialog>
  );
}
