// Owned browser fixture (FX-20): every shadcn primitive in every state it can be in, rendered
// with the real styles.css and the real SiteFooter, so focus, pressed, busy and border styles can
// be measured in a browser. No network, no auth, no server function.
import { createRoot } from "react-dom/client";
import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { Save } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteLink } from "@/components/site/SiteLink";
import "@/styles.css";

const VARIANTS = [
  "default",
  "brand",
  "destructive",
  "outline",
  "secondary",
  "ghost",
  "link",
] as const;
const SIZES = ["default", "sm", "lg", "icon"] as const;
const BADGES = ["default", "secondary", "destructive", "outline"] as const;

function ButtonGrid() {
  return (
    <section className="space-y-4" aria-label="Buttons">
      <h2 className="text-xl font-semibold">Button 按鈕</h2>
      {VARIANTS.map((variant) => (
        <div key={variant} className="space-y-2" data-variant={variant}>
          <h3 className="text-sm font-medium text-muted-foreground">{variant}</h3>
          {SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3" data-size={size}>
              {size === "icon" ? (
                <>
                  <Button variant={variant} size="icon" aria-label="儲存" data-state-name="rest">
                    <Save />
                  </Button>
                  <Button
                    variant={variant}
                    size="icon"
                    aria-label="儲存"
                    disabled
                    data-state-name="disabled"
                  >
                    <Save />
                  </Button>
                  <Button
                    variant={variant}
                    size="icon"
                    aria-label="儲存中…"
                    disabled
                    aria-busy="true"
                    data-state-name="busy"
                  >
                    <Save />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant={variant}
                    size={size}
                    data-state-name="rest"
                    data-focus={size === "default" ? `button-${variant}` : undefined}
                  >
                    儲存
                  </Button>
                  <Button variant={variant} size={size} disabled data-state-name="disabled">
                    儲存
                  </Button>
                  <Button
                    variant={variant}
                    size={size}
                    disabled
                    aria-busy="true"
                    data-state-name="busy"
                  >
                    儲存中…
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function Fields() {
  return (
    <Card data-surface="card">
      <CardHeader>
        <CardTitle as="h2">
          表格欄位 Form fields 兩行標題測試：這是一個較長的卡片標題用來檢查行距
        </CardTitle>
        <CardDescription>Input, Textarea and Select on a card.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fixture-name">姓名</Label>
          <Input id="fixture-name" placeholder="陳大文" data-focus="input" data-field="input" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fixture-message">訊息</Label>
          <Textarea
            id="fixture-message"
            placeholder="請輸入查詢內容"
            data-focus="textarea"
            data-field="textarea"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fixture-deal">類別</Label>
          <Select>
            <SelectTrigger id="fixture-deal" data-focus="select" data-field="select">
              <SelectValue placeholder="請選擇" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sale">買樓</SelectItem>
              <SelectItem value="rent">租樓</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fixture-disabled">停用欄位</Label>
          <Input id="fixture-disabled" disabled value="不可編輯" readOnly />
        </div>
      </CardContent>
    </Card>
  );
}

function Choices() {
  return (
    <section className="space-y-4" aria-label="Choices">
      <h2 className="text-xl font-semibold">選擇 Choices</h2>
      <div className="flex items-center gap-2">
        <Checkbox id="fixture-consent" data-focus="checkbox" />
        <Label htmlFor="fixture-consent">我同意</Label>
      </div>
      <RadioGroup defaultValue="sale" aria-label="類別">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="sale" id="fixture-radio-sale" data-focus="radio" />
          <Label htmlFor="fixture-radio-sale">買樓</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="rent" id="fixture-radio-rent" />
          <Label htmlFor="fixture-radio-rent">租樓</Label>
        </div>
      </RadioGroup>
      <div className="flex items-center gap-2">
        <Switch id="fixture-switch" data-focus="switch" />
        <Label htmlFor="fixture-switch">啟用通知</Label>
        <Switch id="fixture-switch-on" defaultChecked aria-label="已啟用" />
      </div>
      <div className="max-w-sm py-2">
        <Slider defaultValue={[40]} max={100} step={1} aria-label="首期比例" />
      </div>
    </section>
  );
}

function Navigation() {
  return (
    <section className="space-y-4" aria-label="Navigation">
      <h2 className="text-xl font-semibold">分頁 Tabs and accordion</h2>
      <Tabs defaultValue="sale">
        <TabsList>
          <TabsTrigger value="sale" data-focus="tab">
            售盤
          </TabsTrigger>
          <TabsTrigger value="rent">租盤</TabsTrigger>
        </TabsList>
        <TabsContent value="sale">售盤內容</TabsContent>
        <TabsContent value="rent">租盤內容</TabsContent>
      </Tabs>
      <Accordion type="single" collapsible>
        <AccordionItem value="one">
          <AccordionTrigger data-focus="accordion">點樣預約睇樓？</AccordionTrigger>
          <AccordionContent>致電或 WhatsApp 我們。</AccordionContent>
        </AccordionItem>
      </Accordion>
      <div className="flex flex-wrap gap-4 text-sm" data-surface="page">
        <SiteLink href="tel:+85200000000" className="underline-offset-4 hover:underline">
          致電 0000 0000
        </SiteLink>
        <SiteLink href="mailto:fixture@example.invalid" className="hover:underline">
          電郵查詢
        </SiteLink>
      </div>
    </section>
  );
}

function Statuses() {
  return (
    <section className="space-y-4" aria-label="Statuses">
      <h2 className="text-xl font-semibold">狀態 Badges, alert and dialog</h2>
      <div className="flex flex-wrap gap-2">
        {BADGES.map((variant) => (
          <Badge key={variant} variant={variant} data-badge={variant}>
            {variant === "destructive" ? "待回覆" : variant === "outline" ? "開啟" : "租盤"}
          </Badge>
        ))}
      </div>
      <Alert>
        <AlertTitle>提示標題：這是一個較長的提示標題，用來檢查兩行中文標題的行距</AlertTitle>
        <AlertDescription>提示內容</AlertDescription>
      </Alert>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" data-focus="dialog-trigger">
            開啟對話框
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              確認刪除：這是一個較長的對話框標題，用來檢查兩行中文標題的行距
            </DialogTitle>
            <DialogDescription>此操作無法復原。</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DesignStates() {
  return (
    <>
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
        <h1 className="text-3xl font-bold">設計狀態 Design states 晉誠地產</h1>
        <ButtonGrid />
        <Fields />
        <Choices />
        <Navigation />
        <Statuses />
      </main>
      <div data-surface="dark">
        <SiteFooter />
      </div>
    </>
  );
}

const root = createRootRoute({ component: DesignStates });
const router = createRouter({ routeTree: root, defaultPreload: false });
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
