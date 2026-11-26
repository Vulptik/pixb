/**
 * UpdatePassword component for managing user password changes.
 */

'use client';

// React
import { useContext, FC, JSX } from 'react';

// Third-party
import { Formik, Form } from 'formik';
import * as yup from 'yup';

// PixB UI
import { Button } from '@/components/ui/primitives';

// i18n
import { useTranslations } from 'next-intl';

// Components
import { PasswordFields } from '@/components/ui/PasswordField';

// Context
import userContext from '@/lib/contexts/UserContext';

// Actions
import { updatePassword } from '@/lib/actions/profile';

// Utils
import { showToast } from '@/lib/utils/helpers';
import { PASSWORD_MIN, PASSWORD_REGEX } from '@/lib/utils/validationPatterns';
import { getApiErrorMessage, getApiFieldErrorMessage } from '@/lib/utils/apiErrorMessages';

// Types
import { PasswordFormType } from '@/types';

const UpdatePassword: FC = (): JSX.Element => {
  const tp = useTranslations('profile');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const userStore = useContext(userContext);

  const passwordSchema = yup.object().shape({
    password: yup
      .string()
      .required(tv('passwordRequired'))
      .test('password-format', tv('passwordFormat', { min: PASSWORD_MIN }), (value) => {
        if (!value || value.length === 0) return false;
        return PASSWORD_REGEX.test(value);
      }),
    password_confirmation: yup
      .string()
      .required(tv('passwordConfirmRequired'))
      .oneOf([yup.ref('password')], tv('passwordsMustMatch')),
  });

  return (
    <Formik
      initialValues={{
        password: '',
        password_confirmation: '',
      }}
      validationSchema={passwordSchema}
      validateOnChange={false}
      validateOnBlur={false}
      onSubmit={async (
        values: PasswordFormType,
        { setSubmitting, setFieldError, resetForm },
      ): Promise<void> => {
        try {
          const { data, error } = await updatePassword(values);
          if (!error && data) {
            resetForm();
            userStore.update(data);
            showToast(tp('passwordUpdated'), 'success');
          } else {
            if (!error?.items) {
              return showToast(
                error ? getApiErrorMessage(error, tc) : tc('unknownError'),
                'danger',
              );
            }
            const { items } = error;
            for (const [key, value] of Object.entries(items as { [s: string]: never })) {
              setFieldError(key, getApiFieldErrorMessage(key, value[0], tc));
            }
          }
        } catch (error) {
          showToast(getApiErrorMessage(error, tc, 'apiErrorRequestFailed'), 'danger');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {({ errors, isSubmitting, values, setValues }): JSX.Element => (
        <Form className="grid gap-3">
          <PasswordFields
            idPrefix="profile"
            passwordLabel={tp('newPassword')}
            confirmationLabel={tp('confirmPasswordLabel')}
            confirmationAriaLabel={tp('newPasswordConfirmation')}
            values={values}
            onValuesChange={(next) => void setValues(next)}
            disabled={isSubmitting}
            errors={errors}
          />

          <div className="settings-form-actions">
            <Button
              isLoading={isSubmitting}
              size="sm"
              isDisabled={isSubmitting}
              type="submit"
              color="primary"
              variant="solid"
            >
              {isSubmitting ? tp('updating') : tp('updatePassword')}
            </Button>
          </div>
        </Form>
      )}
    </Formik>
  );
};

export default UpdatePassword;
