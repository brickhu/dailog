import { type JSX, Suspense, ErrorBoundary } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { Banner } from "@dailogues/ui";




const styles = stylex.create({
  page: {
    width: "100vw",
    flexShrink: "0", // shellRoot 纵向 flex 容器：内容超高时不被压缩
    display: "flex",
    flexDirection: "column",
    alignItems: "center", // 子项（container*）横向居中；container 自带 margin auto 双保险
  },
})

export function Page(props: {
    children? : JSX.Element,
    xstyle? : StyleXStyles
}){
  return (
    <div {...stylex.props(styles.page, props.xstyle)} >
      <ErrorBoundary fallback={(err) => <Banner status="error" title="Something went wrong">{err?.message || "Please try again later"}</Banner>}> 
      <Suspense fallback={<div>loading...</div>}>
        {props?.children}
      </Suspense>
     </ErrorBoundary>
    </div>
  )
}