'use client';

import type React from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';

import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/ui/primitives';
import EnhancedInput from '@/components/ui/EnhancedInput';
import { PasswordField } from '@/components/ui/PasswordField';
import type { SecuritySettingsState } from '@/components/profile/useSecuritySettings';

export function SecuritySettingsModals({
  state,
  onRecoveryCloseAutoFocus,
}: {
  state: SecuritySettingsState;
  onRecoveryCloseAutoFocus?: (event: Event) => void;
}) {
  const t = useTranslations('security');
  const tc = useTranslations('common');

  return (
    <>
      <Modal
        mobilePresentation="sheet"
        isOpen={state.setupModal.isOpen}
        onOpenChange={state.setupModal.onOpenChange}
        size="md"
      >
        <ModalContent>
          <ModalHeader>{t('setupTotp')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground/70 mb-2">{t('scanQrCode')}</p>
            <div className="flex justify-center p-4 bg-white rounded-lg">
              <QRCodeSVG
                role="img"
                aria-label={t('totpQrCodeAlt')}
                value={state.totpUri}
                size={200}
                level="M"
                marginSize={4}
              />
            </div>
            <div className="mt-2">
              <p className="text-sm text-foreground/70 mb-1">{t('enterKeyManually')}</p>
              <div className="flex items-center gap-2 bg-content2 p-2 rounded">
                <code className="text-sm break-all select-all flex-1">{state.totpSecret}</code>
                <Button isIconOnly size="sm" onPress={state.copySecret} aria-label={tc('copy')}>
                  {state.secretCopied ? <Check size={14} /> : <Copy size={14} />}
                </Button>
              </div>
            </div>
            <div className="mt-2">
              <EnhancedInput
                size="md"
                placeholder={t('enterSixDigitCode')}
                value={state.totpCode}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  state.setTotpCode(event.target.value);
                  if (state.totpError) state.setTotpError('');
                }}
                isInvalid={!!state.totpError}
                errorMessage={state.totpError}
                autoFocus
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button onPress={state.setupModal.onClose}>{tc('cancel')}</Button>
            <Button
              color="primary"
              isLoading={state.totpSubmitting}
              isDisabled={state.totpCode.length !== 6}
              onPress={state.handleVerifyTotp}
            >
              {t('verifyAndEnable')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        mobilePresentation="sheet"
        isOpen={state.recoveryModal.isOpen}
        size="md"
        isDismissable={false}
      >
        <ModalContent onCloseAutoFocus={onRecoveryCloseAutoFocus}>
          <ModalHeader hideCloseButton>{t('recoveryCodes')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground/70 mb-2">{t('saveRecoveryCodes')}</p>
            <div className="bg-content2 p-4 rounded-lg">
              <div className="grid grid-cols-2 gap-2">
                {state.recoveryCodes.map((code, index) => (
                  <code key={index} className="text-sm font-mono">
                    {code}
                  </code>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 mt-2">
              <Button
                size="sm"
                variant="flat"
                startContent={state.codesCopied ? <Check size={14} /> : <Copy size={14} />}
                onPress={state.copyRecoveryCodes}
              >
                {state.codesCopied ? tc('copied') : t('copyCodes')}
              </Button>
              <Button
                size="sm"
                variant="flat"
                startContent={<Download size={14} />}
                onPress={state.downloadRecoveryCodes}
              >
                {t('downloadCodes')}
              </Button>
            </div>
            <Checkbox
              className="mt-2 align-top"
              isSelected={state.codesSaved}
              onValueChange={state.setCodesSaved}
            >
              <span className="text-sm">{t('codesSavedConfirm')}</span>
            </Checkbox>
          </ModalBody>
          <ModalFooter>
            <Button
              color="primary"
              isDisabled={!state.codesSaved}
              onPress={state.recoveryModal.onClose}
            >
              {tc('done')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        mobilePresentation="sheet"
        isOpen={state.regenModal.isOpen}
        onOpenChange={state.regenModal.onOpenChange}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>{t('regenerateCodes')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground/70 mb-2">{t('regenerateCodesDesc')}</p>
            <PasswordField
              id="regenerate-password"
              label={t('enterPassword')}
              autoComplete="current-password"
              disabled={state.regenSubmitting}
              value={state.regenPassword}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                state.setRegenPassword(event.target.value);
                if (state.regenError) state.setRegenError('');
              }}
            />
            <p className="text-sm text-foreground/70 text-center my-1">{tc('or')}</p>
            <EnhancedInput
              size="md"
              placeholder={t('enterSixDigitCode')}
              value={state.regenTotpCode}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                state.setRegenTotpCode(event.target.value);
                if (state.regenError) state.setRegenError('');
              }}
              isInvalid={!!state.regenError}
              errorMessage={state.regenError}
            />
          </ModalBody>
          <ModalFooter>
            <Button onPress={state.regenModal.onClose}>{tc('cancel')}</Button>
            <Button
              color="primary"
              isLoading={state.regenSubmitting}
              onPress={state.handleRegenerateCodes}
            >
              {t('regenerateCodes')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        mobilePresentation="sheet"
        isOpen={state.disableModal.isOpen}
        onOpenChange={state.disableModal.onOpenChange}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>{t('disableTotp')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground/70 mb-2">{t('enterCodeToConfirm')}</p>
            <EnhancedInput
              size="md"
              placeholder={t('enterSixDigitCode')}
              value={state.disableCode}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                state.setDisableCode(event.target.value);
                if (state.disableError) state.setDisableError('');
              }}
              isInvalid={!!state.disableError}
              errorMessage={state.disableError}
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button onPress={state.disableModal.onClose}>{tc('cancel')}</Button>
            <Button
              color="danger"
              isLoading={state.disableSubmitting}
              isDisabled={state.disableCode.length !== 6}
              onPress={state.handleDisableTotp}
            >
              {t('disable2FA')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        mobilePresentation="sheet"
        isOpen={state.passkeyModal.isOpen}
        onOpenChange={state.passkeyModal.onOpenChange}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>{t('addPasskeyTitle')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground/70 mb-2">{t('passkeyNameDesc')}</p>
            <EnhancedInput
              size="md"
              placeholder={t('passkeyNamePlaceholder')}
              value={state.passkeyName}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                state.setPasskeyName(event.target.value)
              }
              autoFocus
            />
          </ModalBody>
          <ModalFooter>
            <Button onPress={state.passkeyModal.onClose}>{tc('cancel')}</Button>
            <Button
              color="primary"
              isLoading={state.passkeySubmitting}
              isDisabled={!state.passkeyName.trim()}
              onPress={state.handleAddPasskey}
            >
              {t('registerPasskey')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
