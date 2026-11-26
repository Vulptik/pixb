/**
 * ProfilePicture component for managing user avatar uploads and display.
 */

'use client';

// React
import { FC, useState, useRef, ChangeEvent, useContext, JSX, useEffect, useCallback } from 'react';

// Third-party
import Uppy, { UppyFile, Meta } from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';

// PixB UI
import { Avatar, Button } from '@/components/ui/primitives';
import { LoadingMark } from '@/components/ui/LoadingMark';

// i18n
import { useTranslations } from 'next-intl';

// Icons
import { Trash2, UploadIcon } from 'lucide-react';

// Contexts
import userContext from '@/lib/contexts/UserContext';

// Actions
import { removeProfilePicture } from '@/lib/actions/avatars';

// Utils
import { showToast, uppyConfig } from '@/lib/utils/helpers';
import { getApiUrlWithPort } from '@/lib/utils/config';
import { IMAGE_TYPES } from '@/lib/utils/mimeTypes';
import { getApiErrorMessage } from '@/lib/utils/apiErrorMessages';
import AvatarCropModal from '@/components/profile/AvatarCropModal';

// Custom hook for avatar management
const useAvatarManager = () => {
  const userStore = useContext(userContext);
  const targetUser = userStore.data;
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Initialize with actual avatar to prevent hydration mismatch
  const initialAvatar = targetUser?.attributes?.avatar || { small: '', medium: '', large: '' };
  const [avatarSrc, setAvatarSrc] = useState<string | undefined>(initialAvatar.large || undefined);

  // Update avatar source when user data changes
  useEffect(() => {
    const newAvatarSrc = targetUser?.attributes?.avatar || { small: '', medium: '', large: '' };
    setAvatarSrc(newAvatarSrc.large || undefined);
  }, [targetUser?.attributes?.avatar]);

  const updateAvatar = useCallback(
    (newAvatar: string) => {
      setAvatarSrc(newAvatar);
      if (userStore.data) {
        userStore.update({
          ...userStore.data,
          attributes: {
            ...userStore.data.attributes,
            avatar: { small: newAvatar, medium: newAvatar, large: newAvatar },
          },
        });
      }
    },
    [userStore],
  );

  const clearAvatar = useCallback(() => {
    setAvatarSrc(undefined);
    if (userStore.data) {
      userStore.update({
        ...userStore.data,
        attributes: { ...userStore.data.attributes, avatar: { small: '', medium: '', large: '' } },
      });
    }
  }, [userStore]);

  return {
    isUploading,
    setIsUploading,
    uploadProgress,
    setUploadProgress,
    avatarSrc,
    updateAvatar,
    clearAvatar,
    username: targetUser?.attributes?.username,
    hasUserData: !!userStore.data,
  };
};

// Custom hook for Uppy configuration
const useUppyUploader = () => {
  const [uppy] = useState(() => {
    const instance = new Uppy<Meta, Record<string, never>>({
      ...uppyConfig,
      autoProceed: true,
      restrictions: { ...uppyConfig.restrictions, maxNumberOfFiles: 1 },
    });

    const baseUrl = getApiUrlWithPort();
    const endpoint = `${baseUrl}/user/update_profile_picture`;

    instance.use(XHRUpload, {
      endpoint,
      fieldName: 'user[avatar]',
      formData: true,
      bundle: false,
      withCredentials: true,
    });

    return instance;
  });

  return uppy;
};

// Custom hook for file handling
const useFileHandler = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) setSelectedFile(file);
    event.target.value = '';
  }, []);

  const triggerFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return { fileInputRef, handleFileChange, triggerFileSelect, selectedFile, setSelectedFile };
};

const UpdateProfilePicture: FC = (): JSX.Element | null => {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const {
    isUploading,
    setIsUploading,
    uploadProgress,
    setUploadProgress,
    avatarSrc,
    updateAvatar,
    clearAvatar,
    username,
    hasUserData,
  } = useAvatarManager();

  const uppy = useUppyUploader();
  const { fileInputRef, handleFileChange, triggerFileSelect, selectedFile, setSelectedFile } =
    useFileHandler();

  const handleCroppedAvatar = useCallback(
    (file: File) => {
      setSelectedFile(null);
      uppy.getFiles().forEach((existingFile) => uppy.removeFile(existingFile.id));
      uppy.addFile({ name: file.name, type: file.type, data: file });
    },
    [setSelectedFile, uppy],
  );

  // Remove avatar handler
  const handleRemoveAvatar = useCallback(async (): Promise<void> => {
    setIsUploading(true);
    try {
      const { error } = await removeProfilePicture();
      if (error) {
        showToast(getApiErrorMessage(error, tc), 'danger');
      } else {
        clearAvatar();
        showToast(t('avatarRemoved'), 'success');
      }
    } catch (error) {
      showToast(t('avatarRemoveFailed'), 'danger');
      console.log(error);
    } finally {
      setIsUploading(false);
    }
  }, [setIsUploading, clearAvatar, t, tc]);

  // Uppy event handlers
  useEffect(() => {
    const handleFileAdded = () => {
      setIsUploading(true);
    };

    const handleProgress = (progress: number) => {
      setUploadProgress(progress);
    };

    const handleUploadSuccess = (
      file: UppyFile<Meta, Record<string, never>> | undefined,
      response: { body?: unknown },
    ) => {
      setIsUploading(false);
      setUploadProgress(0);

      if (
        response.body &&
        typeof response.body === 'object' &&
        response.body !== null &&
        'attributes' in response.body
      ) {
        const userData = response.body as {
          attributes?: { avatar?: { small: string; medium: string; large: string } };
        };
        const newAvatar = userData?.attributes?.avatar?.large;
        if (newAvatar) {
          updateAvatar(newAvatar);
          showToast(t('avatarUpdated'), 'success');
        } else {
          showToast(t('avatarUpdateFailed'), 'danger');
        }
      } else {
        showToast(t('avatarUpdateFailed'), 'danger');
      }
    };

    const handleError = (error: { message: string }) => {
      console.error('[Avatar Upload] Error:', error);
      setIsUploading(false);
      setUploadProgress(0);
      showToast(
        error.message ? getApiErrorMessage(error.message, tc) : t('avatarUpdateFailed'),
        'danger',
      );
    };

    uppy.on('file-added', handleFileAdded);
    uppy.on('progress', handleProgress);
    uppy.on('upload-success', handleUploadSuccess);
    uppy.on('error', handleError);

    return () => {
      uppy.off('file-added', handleFileAdded);
      uppy.off('progress', handleProgress);
      uppy.off('upload-success', handleUploadSuccess);
      uppy.off('error', handleError);
    };
  }, [uppy, setIsUploading, setUploadProgress, updateAvatar, t, tc]);

  // Cleanup Uppy instance on unmount to allow bfcache
  useEffect(() => {
    return () => {
      if (uppy) {
        // Cancel all uploads and close connections
        uppy.cancelAll();
        // Close method exists but TypeScript types don't include it
        if ('close' in uppy && typeof uppy.close === 'function') {
          uppy.close();
        }
      }
    };
  }, [uppy]);

  // Early return if no user data
  if (!hasUserData) return null;

  return (
    <div className="profile-picture">
      <div>
        <div className="relative">
          <Avatar
            isLoading={isUploading}
            className="relative min-w-0 p-0 w-30 h-30"
            color="default"
            name={username || t('profilePhoto')}
            size="lg"
            radius="sm"
            src={avatarSrc}
            spinner={
              <span
                className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background text-primary"
                role="status"
                aria-label={tc('loading')}
              >
                <LoadingMark size={32} />
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <span className="text-sm">{uploadProgress}%</span>
                )}
              </span>
            }
          />
        </div>
      </div>
      <div className="profile-picture-details">
        <div className="profile-avatar-actions flex flex-row gap-2 items-center">
          {/* Upload Button */}
          <Button
            startContent={<UploadIcon size={16} />}
            isDisabled={isUploading}
            size="sm"
            onPress={triggerFileSelect}
          >
            {t('uploadAvatar')}
          </Button>

          {/* Remove Button */}
          <Button
            startContent={<Trash2 size={16} />}
            isDisabled={isUploading || !avatarSrc}
            size="sm"
            onPress={handleRemoveAvatar}
          >
            {t('removeAvatar')}
          </Button>

          <input
            type="file"
            accept={IMAGE_TYPES.join(', ')}
            ref={fileInputRef}
            onChange={handleFileChange}
            hidden
          />
        </div>
        <div className="flex flex-col gap-1 text-sm text-foreground/60">
          <div>{t('avatarFormats')}</div>
          <div>{t('avatarMaxSize')}</div>
        </div>
      </div>
      <AvatarCropModal
        file={selectedFile}
        onCancel={() => setSelectedFile(null)}
        onConfirm={handleCroppedAvatar}
      />
    </div>
  );
};

export default UpdateProfilePicture;
