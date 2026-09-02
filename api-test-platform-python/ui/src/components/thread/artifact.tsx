/**
 * 版权所有 (c) 2023-2026 北京慧测信息技术有限公司(但问智能) 保留所有权利。
 * 
 * 本代码版权归北京慧测信息技术有限公司(但问智能)所有，仅用于学习交流目的，未经公司商业授权，
 * 不得用于任何商业用途，包括但不限于商业环境部署、售卖或以任何形式进行商业获利。违者必究。
 * 
 * 授权商业应用请联系微信：huice666
 */

import {
  HTMLAttributes,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Setter<T> = (value: T | ((value: T) => T)) => void;

const ArtifactSlotContext = createContext<{
  open: [string | null, Setter<string | null>];
  mounted: [string | null, Setter<string | null>];

  title: [HTMLElement | null, Setter<HTMLElement | null>];
  content: [HTMLElement | null, Setter<HTMLElement | null>];

  context: [Record<string, unknown>, Setter<Record<string, unknown>>];
}>(null!);

/**
 * Headless component that will obtain the title and content of the artifact
 * and render them in place of the `ArtifactContent` and `ArtifactTitle` components via
 * React Portals.
 */
const ArtifactSlot = (props: {
  id: string;
  children?: ReactNode;
  title?: ReactNode;
}) => {
  const context = useContext(ArtifactSlotContext);

  const [ctxMounted, ctxSetMounted] = context.mounted;
  const [content] = context.content;
  const [title] = context.title;

  const isMounted = ctxMounted === props.id;
  const isEmpty = props.children == null && props.title == null;

  useEffect(() => {
    if (isEmpty) {
      ctxSetMounted((open) => (open === props.id ? null : open));
    }
  }, [isEmpty, ctxSetMounted, props.id]);

  if (!isMounted) return null;
  return (
    <>
      {title != null ? createPortal(<>{props.title}</>, title) : null}
      {content != null ? createPortal(<>{props.children}</>, content) : null}
    </>
  );
};

export function ArtifactContent(props: HTMLAttributes<HTMLDivElement>) {
  const context = useContext(ArtifactSlotContext);

  const [mounted] = context.mounted;
  const ref = useRef<HTMLDivElement>(null);
  const [, setStateRef] = context.content;

  useLayoutEffect(
    () => setStateRef?.(mounted ? ref.current : null),
    [setStateRef, mounted],
  );

  if (!mounted) return null;
  return (
    <div
      {...props}
      ref={ref}
    />
  );
}

export function ArtifactTitle(props: HTMLAttributes<HTMLDivElement>) {
  const context = useContext(ArtifactSlotContext);

  const ref = useRef<HTMLDivElement>(null);
  const [, setStateRef] = context.title;

  useLayoutEffect(() => setStateRef?.(ref.current), [setStateRef]);

  return (
    <div
      {...props}
      ref={ref}
    />
  );
}

export function ArtifactProvider(props: { children?: ReactNode }) {
  const content = useState<HTMLElement | null>(null);
  const title = useState<HTMLElement | null>(null);

  const open = useState<string | null>(null);
  const mounted = useState<string | null>(null);
  const context = useState<Record<string, unknown>>({});

  return (
    <ArtifactSlotContext.Provider
      value={{ open, mounted, title, content, context }}
    >
      {props.children}
    </ArtifactSlotContext.Provider>
  );
}

/**
 * Provides a value to be passed into `meta.artifact` field
 * of the `LoadExternalComponent` component, to be consumed by the `useArtifact` hook
 * on the generative UI side.
 */
export function useArtifact() {
  const id = useId();
  const context = useContext(ArtifactSlotContext);
  const [ctxOpen, ctxSetOpen] = context.open;
  const [ctxContext, ctxSetContext] = context.context;
  const [, ctxSetMounted] = context.mounted;

  const open = ctxOpen === id;
  const setOpen = useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      if (typeof value === "boolean") {
        ctxSetOpen(value ? id : null);
      } else {
        ctxSetOpen((open) => (open === id ? null : id));
      }

      ctxSetMounted(id);
    },
    [ctxSetOpen, ctxSetMounted, id],
  );

  const ArtifactContent = useCallback(
    (props: { title?: React.ReactNode; children: React.ReactNode }) => {
      return (
        <ArtifactSlot
          id={id}
          title={props.title}
        >
          {props.children}
        </ArtifactSlot>
      );
    },
    [id],
  );

  return [
    ArtifactContent,
    { open, setOpen, context: ctxContext, setContext: ctxSetContext },
  ] as [
    typeof ArtifactContent,
    {
      open: typeof open;
      setOpen: typeof setOpen;
      context: typeof ctxContext;
      setContext: typeof ctxSetContext;
    },
  ];
}

/**
 * General hook for detecting if any artifact is open.
 */
export function useArtifactOpen() {
  const context = useContext(ArtifactSlotContext);
  const [ctxOpen, setCtxOpen] = context.open;

  const open = ctxOpen !== null;
  const onClose = useCallback(() => setCtxOpen(null), [setCtxOpen]);

  return [open, onClose] as const;
}

/**
 * Artifacts may at their discretion provide additional context
 * that will be used when creating a new run.
 */
export function useArtifactContext() {
  const context = useContext(ArtifactSlotContext);
  return context.context;
}
