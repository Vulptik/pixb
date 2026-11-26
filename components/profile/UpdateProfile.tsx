/**
 * UpdateProfile component for managing user profile information.
 */

'use client';

// React
import { useContext, FC, JSX } from 'react';

// Third-party
import { Formik, Form, Field } from 'formik';
import * as yup from 'yup';

// PixB UI
import { Button } from '@/components/ui/primitives';

// i18n
import { useTranslations } from 'next-intl';

// Components
import EnhancedInput from '@/components/ui/EnhancedInput';

// Context
import userContext from '@/lib/contexts/UserContext';

// Actions
import { updateProfile } from '@/lib/actions/profile';

// Utils
import { showToast } from '@/lib/utils/helpers';
import { getApiErrorMessage, getApiFieldErrorMessage } from '@/lib/utils/apiErrorMessages';
import {
  EMAIL_REGEX,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_REGEX,
} from '@/lib/utils/validationPatterns';

// Icons
import { Mail, User } from 'lucide-react';

// Types
import { profileFormType } from '@/types';

const UpdateProfile: FC = (): JSX.Element | null => {
  const tp = useTranslations('profile');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const userStore = useContext(userContext);
  if (!userStore.data) return null;
  const {
    data: {
      attributes: { username, email },
    },
  } = userStore;

  const profileSchema = yup.object().shape({
    username: yup
      .string()
      .transform((value) => (typeof value === 'string' ? value.trim() : value))
      .required(tv('usernameRequired'))
      .min(USERNAME_MIN, tv('usernameMin', { min: USERNAME_MIN }))
      .max(USERNAME_MAX, tv('usernameMax', { max: USERNAME_MAX }))
      .matches(USERNAME_REGEX, tv('usernameFormat')),
    email: yup
      .string()
      .transform((value) => (typeof value === 'string' ? value.trim() : value))
      .required(tv('emailRequired'))
      .matches(EMAIL_REGEX, tv('invalidEmail')),
  });

  return (
    <Formik
      initialValues={{ username: username, email: email }}
      validationSchema={profileSchema}
      validateOnChange={false}
      validateOnBlur={false}
      onSubmit={async (
        values: profileFormType,
        { setSubmitting, setFieldError },
      ): Promise<void> => {
        try {
          const { data, error } = await updateProfile(values);
          if (!error && data) {
            userStore.update(data);
            showToast(tp('profileUpdated'), 'success');
            return;
          }
          if (!error?.items) {
            return showToast(error ? getApiErrorMessage(error, tc) : tc('unknownError'), 'danger');
          }
          for (const [key, value] of Object.entries(error.items as { [s: string]: never })) {
            setFieldError(key, getApiFieldErrorMessage(key, value[0], tc));
          }
        } catch (error) {
          showToast(getApiErrorMessage(error, tc, 'apiErrorRequestFailed'), 'danger');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {({ errors, isSubmitting }): JSX.Element => (
        <Form className="settings-profile-form">
          <div className="settings-profile-field">
            <label className="settings-input-label" htmlFor="username">
              {tp('usernamePlaceholder')}
            </label>
            <Field
              startContent={<User size={16} className="shrink-0" />}
              aria-label={tp('usernamePlaceholder')}
              id="username"
              name="username"
              placeholder={tp('usernamePlaceholder')}
              type="text"
              as={EnhancedInput}
              isDisabled={isSubmitting}
              isInvalid={errors.username}
              errorMessage={errors.username && errors.username}
            />
          </div>
          <div className="settings-profile-field">
            <label className="settings-input-label" htmlFor="email">
              {tp('emailLabel')}
            </label>
            <Field
              startContent={<Mail size={16} className="shrink-0" />}
              aria-label={tp('emailLabel')}
              id="email"
              name="email"
              placeholder={tp('emailPlaceholder')}
              type="email"
              as={EnhancedInput}
              isDisabled={isSubmitting}
              isInvalid={errors.email}
              errorMessage={errors.email && errors.email}
            />
          </div>

          <div className="settings-form-actions">
            <Button
              isLoading={isSubmitting}
              size="sm"
              isDisabled={isSubmitting}
              type="submit"
              color="primary"
              variant="solid"
            >
              {isSubmitting ? tp('updating') : tp('updateProfile')}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default UpdateProfile;
