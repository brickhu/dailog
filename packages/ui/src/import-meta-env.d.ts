// 消费端（vite/vinxi）注入 import.meta.env；本声明让 ui 包独立 typecheck 通过。
// 与 vite/client 的 ImportMeta 是接口合并，无冲突。
interface ImportMeta {
  readonly env: {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly SSR: boolean;
    readonly MODE: string;
    readonly BASE_URL: string;
  };
}