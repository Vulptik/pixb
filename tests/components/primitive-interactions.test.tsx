// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Slider,
  useDisclosure,
  ToastProvider,
  addToast,
} from '@/components/ui/primitives';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('shared primitive interactions', () => {
  it('renders icon-only children and alternate loading content', () => {
    const { rerender } = render(
      <Button isIconOnly aria-label="Add">
        +
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Add' })).toHaveTextContent('+');
    rerender(<Button isLoading>Saving</Button>);
    expect(screen.getByRole('button')).toHaveTextContent('Saving');
  });
  it('supports default slider limits, numeric display and array update payloads', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const change = vi.fn();
    const { rerender } = render(
      <Slider getValue={(value) => `Value ${value}`} onChange={change} />,
    );
    expect(screen.getByText('Value 0')).toBeVisible();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '100');
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(change).toHaveBeenCalledWith(1);
    rerender(<Slider value={[10, 30]} defaultValue={[10, 30]} onChange={change} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(change).toHaveBeenLastCalledWith([11, 30]);
  });
  it('calls click before press and respects cancellation and disabled/loading states', () => {
    const click = vi.fn(),
      press = vi.fn();
    const { rerender } = render(
      <Button onClick={click} onPress={press} startContent="before" endContent="after">
        save
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(click).toHaveBeenCalledOnce();
    expect(press).toHaveBeenCalledOnce();
    rerender(
      <Button onClick={(e) => e.preventDefault()} onPress={press}>
        save
      </Button>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(press).toHaveBeenCalledOnce();
    rerender(
      <Button isLoading isIconOnly onPress={press}>
        save
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('button'));
    expect(press).toHaveBeenCalledOnce();
    rerender(
      <Button isDisabled onPress={press}>
        save
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });
  it.each(['bordered', 'ghost', 'faded', 'flat', 'light', 'solid'] as const)(
    'renders accessible %s button variants',
    (variant) => {
      render(
        <Button
          as="a"
          href="/settings"
          variant={variant}
          size="full"
          fullWidth
          isIconOnly
          aria-label="Settings"
        >
          S
        </Button>,
      );
      expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    },
  );
  it('falls back after image failure, retries changed sources, and handles loading avatars', () => {
    const press = vi.fn();
    const { rerender } = render(<Avatar src="/one.png" name="Ada" onPress={press} />);
    fireEvent.click(screen.getByRole('img'));
    expect(press).toHaveBeenCalledOnce();
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<Avatar src="/two.png" />);
    expect(screen.getByAltText('')).toHaveAttribute('src', '/two.png');
    rerender(<Avatar isLoading spinner={<span>loading avatar</span>} />);
    expect(screen.getByText('loading avatar')).toBeVisible();
    rerender(<Avatar isLoading />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
  it('exposes input descriptions, validation, labels, and both change callbacks', () => {
    const change = vi.fn(),
      value = vi.fn();
    const { rerender } = render(
      <Input
        label="Name"
        description="Public name"
        onChange={change}
        onValueChange={value}
        isRequired
      />,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription('Public name');
    fireEvent.change(input, { target: { value: 'Ada' } });
    expect(change).toHaveBeenCalledOnce();
    expect(value).toHaveBeenCalledWith('Ada');
    rerender(<Input label="Name" color="danger" errorMessage="Required" isDisabled isReadOnly />);
    expect(screen.getByLabelText('Name')).toBeInvalid();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Required');
  });
  it('updates checkboxes in both directions and forwards click notifications', () => {
    const value = vi.fn(),
      change = vi.fn();
    render(
      <Checkbox onValueChange={value} onChange={change}>
        Remember
      </Checkbox>,
    );
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    expect(value.mock.calls).toEqual([[true], [false]]);
    expect(change).toHaveBeenCalledTimes(2);
  });
  it('normalizes numeric slider values and keyboard updates with legacy min/max aliases', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const change = vi.fn(),
      commit = vi.fn();
    const { rerender } = render(
      <Slider
        id="zoom"
        label="Zoom"
        defaultValue={20}
        minValue={10}
        maxValue={30}
        onChange={change}
        onChangeEnd={commit}
        getValue={(v) => `${v}%`}
        startContent="start"
        endContent="end"
      />,
    );
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuemin', '10');
    expect(slider).toHaveAttribute('aria-valuemax', '30');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(change).toHaveBeenCalledWith(21);
    expect(commit).toHaveBeenCalled();
    rerender(<Slider value={[15]} min={0} max={50} isDisabled />);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '15');
  });
  it('disclosure supports explicit and toggle changes and preserves supplied props', () => {
    const { result } = renderHook(() => useDisclosure());
    expect(result.current.isOpen).toBe(false);
    const props = { id: 'trigger' };
    expect(result.current.getButtonProps(props)).toBe(props);
    expect(result.current.getDisclosureProps(props)).toBe(props);
    expect(result.current.getButtonProps()).toEqual({});
    expect(result.current.getDisclosureProps()).toEqual({});
    const { unmount } = render(<DisclosureHarness />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByText('opened')).toBeVisible();
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('closed')).toBeVisible();
    fireEvent.click(screen.getByText('explicit'));
    expect(screen.getByText('opened')).toBeVisible();
    fireEvent.click(screen.getByText('close'));
    expect(screen.getByText('closed')).toBeVisible();
    unmount();
  });
});
function DisclosureHarness() {
  const d = useDisclosure();
  return (
    <>
      <span>{d.isOpen ? 'opened' : 'closed'}</span>
      <button onClick={d.onOpen}>open</button>
      <button onClick={d.onClose}>close</button>
      <button onClick={() => d.onOpenChange()}>toggle</button>
      <button onClick={() => d.onOpenChange(true)}>explicit</button>
    </>
  );
}

describe('modal events', () => {
  it.each(['sheet', 'fullscreen'] as const)(
    'passes the %s mobile presentation through the portal while retaining close behavior',
    (mobilePresentation) => {
      const close = vi.fn();
      render(
        <Modal isOpen mobilePresentation={mobilePresentation} onClose={close}>
          <ModalContent>
            <ModalHeader>Mobile dialog</ModalHeader>
            <ModalBody>Scrollable content</ModalBody>
            <ModalFooter>Actions</ModalFooter>
          </ModalContent>
        </Modal>,
      );
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('data-mobile-presentation', mobilePresentation);
      expect(dialog.querySelector('.pixb-modal-header')).toHaveTextContent('Mobile dialog');
      expect(dialog.querySelector('.pixb-modal-body')).toHaveTextContent('Scrollable content');
      expect(dialog.querySelector('.pixb-modal-footer')).toHaveTextContent('Actions');
      fireEvent.click(screen.getByRole('button', { name: 'close' }));
      expect(close).toHaveBeenCalledOnce();
    },
  );
  it('dismisses on escape and outside pointer interactions with supplied callbacks', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const close = vi.fn(),
      outside = vi.fn(),
      interact = vi.fn(),
      escape = vi.fn();
    const { rerender } = render(
      <Modal isOpen onClose={close}>
        <ModalContent
          onEscapeKeyDown={escape}
          onPointerDownOutside={outside}
          onInteractOutside={interact}
        >
          <ModalHeader>Title</ModalHeader>
        </ModalContent>
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(escape).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    rerender(
      <Modal isOpen onClose={close}>
        <ModalContent onPointerDownOutside={outside} onInteractOutside={interact}>
          <ModalHeader>Title</ModalHeader>
        </ModalContent>
      </Modal>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(document.querySelector('.pixb-modal-overlay')!, { button: 1 });
    expect(outside).toHaveBeenCalled();
    expect(interact).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it.each(['sm', 'md', 'xl', 'full', undefined])(
    'dismisses a %s modal using its close button',
    (size) => {
      const close = vi.fn(),
        change = vi.fn();
      render(
        <Modal isOpen size={size} onClose={close} onOpenChange={change}>
          <ModalContent>
            <ModalHeader>Title</ModalHeader>
            <ModalBody>Body</ModalBody>
            <ModalFooter>Footer</ModalFooter>
          </ModalContent>
        </Modal>,
      );
      expect(screen.getByRole('dialog')).toHaveTextContent('Body');
      fireEvent.click(screen.getByRole('button', { name: 'close' }));
      expect(close).toHaveBeenCalledOnce();
      expect(change).toHaveBeenCalledWith(false);
    },
  );
  it('forwards content events while preventing parent handlers and dismisses on the overlay', () => {
    const parent = vi.fn(),
      close = vi.fn(),
      click = vi.fn(),
      dbl = vi.fn(),
      mouse = vi.fn(),
      pointer = vi.fn();
    render(
      <div onClick={parent}>
        <Modal isOpen onClose={close}>
          <ModalContent
            onClick={click}
            onDoubleClick={dbl}
            onMouseDown={mouse}
            onPointerDown={pointer}
          >
            <ModalHeader>Title</ModalHeader>
          </ModalContent>
        </Modal>
      </div>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    fireEvent.doubleClick(dialog);
    fireEvent.mouseDown(dialog);
    fireEvent.pointerDown(dialog);
    expect(click).toHaveBeenCalledOnce();
    expect(dbl).toHaveBeenCalledOnce();
    expect(mouse).toHaveBeenCalledOnce();
    expect(pointer).toHaveBeenCalledOnce();
    expect(parent).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.pixb-modal-overlay')!);
    expect(close).toHaveBeenCalledOnce();
  });
  it('supports a non-dismissable modal without a header close button', () => {
    const close = vi.fn(),
      escape = vi.fn();
    render(
      <Modal isOpen isDismissable={false} onClose={close}>
        <ModalContent onEscapeKeyDown={escape}>
          <ModalHeader hideCloseButton>Title</ModalHeader>
        </ModalContent>
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'close' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.pixb-modal-overlay')!);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(escape).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });
  it('forwards outside interactions while retaining a non-dismissable dialog', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const outside = vi.fn(),
      interact = vi.fn(),
      close = vi.fn();
    render(
      <Modal isOpen isDismissable={false} onClose={close}>
        <ModalContent onPointerDownOutside={outside} onInteractOutside={interact}>
          <ModalHeader>Title</ModalHeader>
        </ModalContent>
      </Modal>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(document.querySelector('.pixb-modal-overlay')!, { button: 1 });
    fireEvent.click(document.querySelector('.pixb-modal-overlay')!);
    expect(outside).toHaveBeenCalled();
    expect(interact).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

it('automatically dismisses expired notifications and cancels pending frames on unmount', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const { unmount } = render(<ToastProvider placement="top-right" />);
  act(() => {
    addToast({ title: 'Saved', timeout: 100 });
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(screen.getByText('Saved').closest('.pixb-toast')).toHaveClass('pixb-toast-exiting');
  act(() => {
    vi.advanceTimersByTime(260);
  });
  expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  act(() => {
    addToast({ title: 'Pending' });
  });
  unmount();
  expect(cancel).toHaveBeenCalled();
  vi.useRealTimers();
});
