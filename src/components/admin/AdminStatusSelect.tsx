import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AdminStatusSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function AdminStatusSelect({
  ariaLabel,
  value,
  options,
  placeholder = "選擇狀態",
  disabled,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: AdminStatusSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className="w-full sm:w-44">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
