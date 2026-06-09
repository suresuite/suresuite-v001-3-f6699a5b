import * as React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface StepwiseDatePickerProps {
  date?: Date;
  onSelect?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: (date: Date) => boolean;
  className?: string;
}

type SelectionStep = 'year' | 'month' | 'day';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function StepwiseDatePicker({ 
  date, 
  onSelect, 
  placeholder = "Pick a date",
  disabled,
  className 
}: StepwiseDatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [step, setStep] = React.useState<SelectionStep>('year');
  const [selectedYear, setSelectedYear] = React.useState<number | undefined>(date?.getFullYear());
  const [selectedMonth, setSelectedMonth] = React.useState<number | undefined>(date?.getMonth());
  const [selectedDay, setSelectedDay] = React.useState<number | undefined>(date?.getDate());

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 20 }, (_, i) => currentYear - 10 + i);

  React.useEffect(() => {
    if (date) {
      setSelectedYear(date.getFullYear());
      setSelectedMonth(date.getMonth());
      setSelectedDay(date.getDate());
    }
  }, [date]);

  const handleYearSelect = (year: number) => {
    setSelectedYear(year);
    setStep('month');
  };

  const handleMonthSelect = (month: number) => {
    setSelectedMonth(month);
    setStep('day');
  };

  const handleDaySelect = (day: number) => {
    setSelectedDay(day);
    if (selectedYear && selectedMonth !== undefined) {
      const newDate = new Date(selectedYear, selectedMonth, day);
      if (!disabled || !disabled(newDate)) {
        onSelect?.(newDate);
        setIsOpen(false);
        setStep('year');
      }
    }
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handleReset = () => {
    setStep('year');
    setSelectedYear(date?.getFullYear());
    setSelectedMonth(date?.getMonth());
    setSelectedDay(date?.getDate());
  };

  const renderYearSelection = () => (
    <div className="p-2 w-48">
      <div className="text-xs font-medium mb-2 text-center">Select Year</div>
      <div className="grid grid-cols-4 gap-1 max-h-32 overflow-y-auto">
        {years.map((year) => (
          <Button
            key={year}
            variant={selectedYear === year ? "default" : "ghost"}
            size="sm"
            className="h-6 text-xs p-1"
            onClick={() => handleYearSelect(year)}
          >
            {year}
          </Button>
        ))}
      </div>
    </div>
  );

  const renderMonthSelection = () => (
    <div className="p-2 w-48">
      <div className="flex items-center justify-between mb-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => setStep('year')}
        >
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <div className="text-xs font-medium">{selectedYear}</div>
        <div className="w-5" />
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTHS.map((month, index) => (
          <Button
            key={month}
            variant={selectedMonth === index ? "default" : "ghost"}
            size="sm"
            className="h-6 text-xs p-1"
            onClick={() => handleMonthSelect(index)}
          >
            {month.slice(0, 3)}
          </Button>
        ))}
      </div>
    </div>
  );

  const renderDaySelection = () => {
    if (!selectedYear || selectedMonth === undefined) return null;

    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDay = getFirstDayOfMonth(selectedYear, selectedMonth);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const emptyDays = Array.from({ length: firstDay }, (_, i) => i);

    return (
      <div className="p-2 w-56">
        <div className="flex items-center justify-between mb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={() => setStep('month')}
          >
            <ChevronLeft className="h-3 w-3" />
          </Button>
          <div className="text-xs font-medium">
            {MONTHS[selectedMonth]} {selectedYear}
          </div>
          <div className="w-5" />
        </div>
        
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day) => (
            <div key={day} className="text-xs text-muted-foreground text-center p-1 h-6 flex items-center justify-center">
              {day}
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-1">
          {emptyDays.map((_, index) => (
            <div key={`empty-${index}`} className="h-6" />
          ))}
          {days.map((day) => {
            const dayDate = new Date(selectedYear, selectedMonth, day);
            const isDisabled = disabled && disabled(dayDate);
            return (
              <Button
                key={day}
                variant={selectedDay === day ? "default" : "ghost"}
                size="sm"
                className="h-6 text-xs p-0"
                onClick={() => !isDisabled && handleDaySelect(day)}
                disabled={isDisabled}
              >
                {day}
              </Button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (step) {
      case 'year':
        return renderYearSelection();
      case 'month':
        return renderMonthSelection();
      case 'day':
        return renderDaySelection();
      default:
        return renderYearSelection();
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (open) {
        handleReset();
      }
    }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal text-xs h-8",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-3 w-3" />
          {date ? format(date, "MMM dd, yyyy") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {renderContent()}
      </PopoverContent>
    </Popover>
  );
}