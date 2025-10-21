const STORAGE_KEY = 'ceh-question-bank-state-v1';
const defaultSource = Object.freeze({
  type: 'builtin',
  label: 'Built-in question bank',
  url: 'questions.json',
});

const state = {
  questions: [],
  currentIndex: 0,
  responses: new Map(),
  source: { ...defaultSource },
};

const questionArea = document.getElementById('question-area');
const progressEl = document.getElementById('progress');
const scoreEl = document.getElementById('score');
const accuracyEl = document.getElementById('accuracy');
const answeredEl = document.getElementById('answered');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const resetBtn = document.getElementById('reset');

const fileInput = document.getElementById('question-file');
const urlInput = document.getElementById('question-url');
const loadUrlBtn = document.getElementById('load-url');
const loadDefaultBtn = document.getElementById('load-default');
const sourceLabel = document.getElementById('source-label');
const loadFeedback = document.getElementById('load-feedback');

function showFeedback(message, type) {
  if (!loadFeedback) {
    return;
  }
  loadFeedback.textContent = message || '';
  if (type) {
    loadFeedback.dataset.type = type;
  } else {
    delete loadFeedback.dataset.type;
  }
}

function updateSourceLabel() {
  if (!sourceLabel) {
    return;
  }
  const label = state.source?.label || defaultSource.label;
  sourceLabel.textContent = label;
}

function sanitizeQuestionBank(rawQuestions) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('The question bank is empty or invalid.');
  }

  const seenIds = new Set();

  return rawQuestions.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Question ${index + 1} is invalid.`);
    }

    const prompt = typeof item.question === 'string' ? item.question.trim() : '';
    if (!prompt) {
      throw new Error(`Question ${index + 1} is missing a prompt.`);
    }

    const options = Array.isArray(item.options)
      ? item.options.map((option, optionIndex) => {
          if (!option || typeof option !== 'object') {
            throw new Error(`Option ${optionIndex + 1} in question ${index + 1} is invalid.`);
          }
          const label =
            typeof option.label === 'string'
              ? option.label.trim()
              : String(option.label ?? '').trim();
          const text = typeof option.text === 'string' ? option.text.trim() : '';
          if (!label || !text) {
            throw new Error(`Option ${optionIndex + 1} in question ${index + 1} is missing a label or text.`);
          }
          return { label, text };
        })
      : [];

    if (!options.length) {
      throw new Error(`Question ${index + 1} must include at least one option.`);
    }

    const optionLabels = new Set(options.map((option) => option.label));
    const rawCorrectAnswers = Array.isArray(item.correctAnswers) ? item.correctAnswers : [];
    const correctAnswers = rawCorrectAnswers
      .map((answer) => String(answer).trim())
      .filter((answer) => optionLabels.has(answer));

    if (!correctAnswers.length) {
      throw new Error(`Question ${index + 1} must include at least one valid correct answer.`);
    }

    const baseId = item.id ?? `question-${index + 1}`;
    let uniqueId = baseId;
    let suffix = 1;
    while (seenIds.has(uniqueId)) {
      suffix += 1;
      uniqueId = `${baseId}-${suffix}`;
    }
    seenIds.add(uniqueId);

    return {
      ...item,
      id: uniqueId,
      question: prompt,
      options,
      correctAnswers,
    };
  });
}

function applyQuestionBank(questions, source) {
  state.questions = questions;
  state.currentIndex = 0;
  state.responses = new Map();
  state.source = source ? { ...source } : { ...defaultSource };
  renderQuestion();
  persistState();
}

function displayLoadingState(message = 'Loading…') {
  if (state.questions.length) {
    return;
  }
  questionArea.innerHTML = '';
  const loading = document.createElement('p');
  loading.textContent = message;
  questionArea.appendChild(loading);
  progressEl.textContent = message;
  scoreEl.textContent = 'Score: 0 / 0';
  accuracyEl.textContent = 'Accuracy: 0%';
  answeredEl.textContent = 'Answered: 0';
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === 'string' ? error : 'An unexpected error occurred.');
}

function handleLoadError(error) {
  const normalized = normalizeError(error);
  console.error(normalized);
  showFeedback(normalized.message || 'Unable to load question bank.', 'error');
  if (state.questions.length) {
    return;
  }
  questionArea.innerHTML = '';
  const failure = document.createElement('div');
  failure.className = 'result-box incorrect';
  const heading = document.createElement('strong');
  heading.textContent = 'Load failed.';
  failure.append(heading, document.createTextNode(normalized.message));
  questionArea.appendChild(failure);
  progressEl.textContent = 'Unable to load question bank.';
  scoreEl.textContent = 'Score: 0 / 0';
  accuracyEl.textContent = 'Accuracy: 0%';
  answeredEl.textContent = 'Answered: 0';
}

async function loadQuestionBankFromUrl(url, source) {
  const label = source?.label || url;
  displayLoadingState('Loading question bank…');
  showFeedback(`Loading question bank from ${label}…`, 'info');
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Unable to load questions (status ${response.status})`);
    }
    const data = await response.json();
    const questions = sanitizeQuestionBank(data);
    applyQuestionBank(questions, source);
    showFeedback(`Loaded ${questions.length} questions from ${label}.`, 'success');
    return true;
  } catch (error) {
    handleLoadError(error);
    return false;
  }
}

async function loadQuestionBankFromFile(file) {
  const label = file.name || 'uploaded file';
  displayLoadingState(`Loading ${label}…`);
  showFeedback(`Loading question bank from ${label}…`, 'info');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const questions = sanitizeQuestionBank(data);
    applyQuestionBank(questions, { type: 'file', label });
    showFeedback(`Loaded ${questions.length} questions from ${label}.`, 'success');
    return true;
  } catch (error) {
    const message = error instanceof SyntaxError ? new Error(`Invalid JSON file: ${error.message}`) : error;
    handleLoadError(message);
    return false;
  }
}

function persistState() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    if (!state.questions.length) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload = {
      questions: state.questions,
      currentIndex: state.currentIndex,
      source: state.source,
      responses: Array.from(state.responses.entries()).map(([id, entry]) => ({
        id,
        correct: Boolean(entry.correct),
        selected: Array.from(entry.selected || []),
      })),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error('Unable to save quiz progress.', error);
  }
}

function restoreState() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.questions) || !parsed.questions.length) {
      return false;
    }
    const questions = sanitizeQuestionBank(parsed.questions);
    const questionsById = new Map(questions.map((question) => [question.id, question]));
    const responses = new Map();
    if (Array.isArray(parsed.responses)) {
      parsed.responses.forEach((entry) => {
        if (!entry || entry.id == null) {
          return;
        }
        const question = questionsById.get(entry.id);
        if (!question) {
          return;
        }
        const optionLabels = new Set(question.options.map((option) => option.label));
        const selectedValues = Array.isArray(entry.selected)
          ? entry.selected.map((value) => String(value))
          : [];
        const filtered = new Set(selectedValues.filter((value) => optionLabels.has(value)));
        const correctSet = new Set(question.correctAnswers);
        const isCorrect = filtered.size === correctSet.size && [...filtered].every((value) => correctSet.has(value));
        responses.set(entry.id, {
          selected: filtered,
          correct: isCorrect,
        });
      });
    }
    state.questions = questions;
    const storedIndex = Number.parseInt(parsed.currentIndex, 10);
    if (Number.isNaN(storedIndex)) {
      state.currentIndex = 0;
    } else {
      state.currentIndex = Math.min(Math.max(storedIndex, 0), Math.max(questions.length - 1, 0));
    }
    state.responses = responses;
    state.source = parsed.source ? { ...parsed.source } : { ...defaultSource };
    return true;
  } catch (error) {
    console.error('Failed to restore saved progress.', error);
    window.localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

function updateStatus() {
  if (!state.questions.length) {
    return;
  }
  const total = state.questions.length;
  progressEl.textContent = `Question ${state.currentIndex + 1} of ${total}`;

  const answeredEntries = Array.from(state.responses.values());
  const answeredCount = answeredEntries.length;
  const correctCount = answeredEntries.filter((entry) => entry.correct).length;
  const accuracy = answeredCount ? Math.round((correctCount / answeredCount) * 100) : 0;

  scoreEl.textContent = `Score: ${correctCount} / ${answeredCount}`;
  accuracyEl.textContent = `Accuracy: ${accuracy}%`;
  answeredEl.textContent = `Answered: ${answeredCount}`;

  prevBtn.disabled = state.currentIndex === 0;
  nextBtn.disabled = state.currentIndex >= total - 1;
}

function createOption(option, isMultiple, response, correctSet) {
  const label = document.createElement('label');
  label.className = 'option';

  const input = document.createElement('input');
  input.type = isMultiple ? 'checkbox' : 'radio';
  input.name = 'answer';
  input.value = option.label;

  const optionText = document.createElement('div');
  optionText.className = 'option-text';

  const optionLetter = document.createElement('strong');
  optionLetter.textContent = `${option.label}.`;
  optionText.append(optionLetter, document.createTextNode(` ${option.text}`));

  label.append(input, optionText);

  if (response) {
    const selected = response.selected;
    if (selected.has(option.label)) {
      label.classList.add('option--selected');
      input.checked = true;
      if (!correctSet.has(option.label)) {
        label.classList.add('option--incorrect');
      }
    }
    if (correctSet.has(option.label)) {
      label.classList.add('option--correct');
    }
    input.disabled = true;
  }

  return { label, input };
}

function renderQuestion() {
  updateSourceLabel();
  questionArea.innerHTML = '';

  if (!state.questions.length) {
    const loading = document.createElement('p');
    loading.textContent = 'Loading…';
    questionArea.appendChild(loading);
    scoreEl.textContent = 'Score: 0 / 0';
    accuracyEl.textContent = 'Accuracy: 0%';
    answeredEl.textContent = 'Answered: 0';
    return;
  }

  const question = state.questions[state.currentIndex];
  if (!question) {
    return;
  }
  const response = state.responses.get(question.id) || null;
  const correctSet = new Set(question.correctAnswers || []);
  const isMultiple = correctSet.size > 1;

  const card = document.createElement('article');
  card.className = 'question-card';

  const title = document.createElement('h2');
  title.textContent = `Question ${state.currentIndex + 1}`;

  const meta = document.createElement('div');
  meta.className = 'question-meta';
  const sourceSpan = document.createElement('span');
  const questionSource = question.source || state.source?.label || 'Unknown';
  sourceSpan.textContent = `Source: ${questionSource}${
    question.source_number ? ` (Q${question.source_number})` : ''
  }`;
  const instructionSpan = document.createElement('span');
  instructionSpan.textContent = isMultiple ? 'Select all that apply' : 'Select one answer';
  meta.append(sourceSpan, instructionSpan);

  const prompt = document.createElement('p');
  prompt.textContent = question.question;

  const form = document.createElement('form');
  form.className = 'question-form';
  form.setAttribute('aria-describedby', 'instructions');

  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'options';

  const optionElements = question.options.map((option) => {
    const optionElement = createOption(option, isMultiple, response, correctSet);
    optionsContainer.appendChild(optionElement.label);
    return optionElement;
  });

  const instructions = document.createElement('div');
  instructions.className = 'instructions';
  instructions.id = 'instructions';
  instructions.textContent = isMultiple
    ? 'Choose every option that you believe is correct before submitting.'
    : 'Choose the single option that you believe is correct and submit your answer.';

  const actions = document.createElement('div');
  actions.className = 'actions';

  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.textContent = response ? 'Answer submitted' : 'Submit answer';
  submitBtn.disabled = Boolean(response);
  actions.appendChild(submitBtn);

  form.append(optionsContainer, instructions, actions);

  card.append(title, meta, prompt, form);

  if (response) {
    const resultBox = buildResultBox(question, response, correctSet);
    card.appendChild(resultBox);
  } else {
    const toggleSubmitState = () => {
      const selectedValues = getSelectedValues(optionElements);
      submitBtn.disabled = selectedValues.length === 0;
    };
    optionElements.forEach(({ input }) => {
      input.addEventListener('change', () => {
        if (!isMultiple) {
          optionElements.forEach(({ input: otherInput }) => {
            if (otherInput !== input) {
              otherInput.checked = false;
            }
          });
        }
        toggleSubmitState();
      });
    });

    submitBtn.addEventListener('click', () => handleSubmit(question, optionElements, correctSet));
  }

  questionArea.appendChild(card);
  updateStatus();
}

function getSelectedValues(optionElements) {
  return optionElements
    .filter(({ input }) => input.checked)
    .map(({ input }) => input.value);
}

function handleSubmit(question, optionElements, correctSet) {
  const selectedValues = getSelectedValues(optionElements);
  if (selectedValues.length === 0) {
    return;
  }
  const selectedSet = new Set(selectedValues);
  const isCorrect =
    selectedSet.size === correctSet.size && selectedValues.every((value) => correctSet.has(value));

  state.responses.set(question.id, {
    selected: selectedSet,
    correct: isCorrect,
  });

  renderQuestion();
  persistState();
}

function buildResultBox(question, response, correctSet) {
  const resultBox = document.createElement('div');
  resultBox.className = `result-box ${response.correct ? 'correct' : 'incorrect'}`;

  const heading = document.createElement('strong');
  heading.textContent = response.correct ? 'Correct!' : 'Incorrect';
  resultBox.appendChild(heading);

  const summary = document.createElement('p');
  const summaryLabel = document.createElement('strong');
  summaryLabel.textContent = 'Correct answer:';
  const answerText = question.options
    .filter((option) => correctSet.has(option.label))
    .map((option) => `${option.label}. ${option.text}`)
    .join('; ');
  summary.append(summaryLabel, document.createTextNode(` ${answerText}`));
  resultBox.appendChild(summary);

  const feedback = document.createElement('p');
  if (response.correct) {
    feedback.textContent = 'Great job! You selected the right answer.';
  } else {
    const chosen = Array.from(response.selected).sort().join(', ') || 'None';
    const feedbackLabel = document.createElement('strong');
    feedbackLabel.textContent = 'Your answer:';
    feedback.append(feedbackLabel, document.createTextNode(` ${chosen}`));
  }
  resultBox.appendChild(feedback);

  if (question.explanation) {
    const explanation = document.createElement('p');
    const explanationLabel = document.createElement('strong');
    explanationLabel.textContent = 'Explanation:';
    explanation.append(explanationLabel, document.createTextNode(` ${question.explanation}`));
    resultBox.appendChild(explanation);
  }

  return resultBox;
}

prevBtn.addEventListener('click', () => {
  if (state.currentIndex > 0) {
    state.currentIndex -= 1;
    renderQuestion();
    persistState();
  }
});

nextBtn.addEventListener('click', () => {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
    persistState();
  }
});

resetBtn.addEventListener('click', () => {
  if (!state.questions.length) {
    return;
  }
  state.responses.clear();
  state.currentIndex = 0;
  renderQuestion();
  persistState();
  showFeedback('Quiz progress cleared for this question bank.', 'info');
});

function loadDefaultQuestions() {
  return loadQuestionBankFromUrl(defaultSource.url, { ...defaultSource });
}

async function handleUrlLoad() {
  if (!urlInput) {
    return;
  }
  const raw = urlInput.value.trim();
  if (!raw) {
    showFeedback('Enter a URL to load a question bank.', 'error');
    return;
  }
  let normalizedUrl;
  try {
    normalizedUrl = new URL(raw, window.location.href).toString();
  } catch (error) {
    showFeedback('Enter a valid URL to load a question bank.', 'error');
    return;
  }
  const success = await loadQuestionBankFromUrl(normalizedUrl, { type: 'url', label: normalizedUrl, url: normalizedUrl });
  if (success) {
    urlInput.value = '';
  }
}

if (fileInput) {
  fileInput.addEventListener('change', async (event) => {
    const target = event.target;
    if (!target.files || !target.files[0]) {
      return;
    }
    const success = await loadQuestionBankFromFile(target.files[0]);
    target.value = '';
    if (!success) {
      target.focus();
    }
  });
}

if (loadUrlBtn) {
  loadUrlBtn.addEventListener('click', () => {
    handleUrlLoad();
  });
}

if (urlInput) {
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleUrlLoad();
    }
  });
}

if (loadDefaultBtn) {
  loadDefaultBtn.addEventListener('click', () => {
    loadDefaultQuestions();
  });
}

updateSourceLabel();

if (restoreState()) {
  renderQuestion();
  persistState();
  showFeedback('Resumed your previous session.', 'info');
} else {
  displayLoadingState('Loading built-in question bank…');
  loadDefaultQuestions();
}
