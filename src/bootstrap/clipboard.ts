import type { Mesh } from '../network/mesh';

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function readFromClipboard(): Promise<string> {
  return navigator.clipboard.readText();
}

export function createExchangeUI(
  container: HTMLElement,
  mesh: Mesh,
  _onComplete: () => void
): void {
  container.innerHTML = `
    <div class="exchange">
      <h3>Connect to Peer</h3>
      <div class="exchange-tabs">
        <button class="tab active" data-tab="initiate">Create Invite</button>
        <button class="tab" data-tab="join">Join with Invite</button>
      </div>

      <div class="tab-content" id="initiate-tab">
        <p>1. Click "Generate" to create an invite code</p>
        <button id="generate-offer">Generate Invite</button>
        <textarea id="offer-output" readonly placeholder="Invite code will appear here..."></textarea>
        <button id="copy-offer" disabled>Copy to Clipboard</button>

        <p>2. Share the code with peer, then paste their response:</p>
        <textarea id="answer-input" placeholder="Paste peer's response here..."></textarea>
        <button id="accept-answer" disabled>Connect</button>
      </div>

      <div class="tab-content hidden" id="join-tab">
        <p>1. Paste the invite code from your peer:</p>
        <textarea id="offer-input" placeholder="Paste invite code here..."></textarea>
        <button id="accept-offer">Accept Invite</button>

        <p>2. Copy the response and send it back:</p>
        <textarea id="answer-output" readonly placeholder="Response will appear here..."></textarea>
        <button id="copy-answer" disabled>Copy to Clipboard</button>
      </div>
    </div>
  `;

  // Tab switching
  const tabs = container.querySelectorAll('.tab');
  const initiateTab = container.querySelector('#initiate-tab') as HTMLElement;
  const joinTab = container.querySelector('#join-tab') as HTMLElement;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = (tab as HTMLElement).dataset.tab;
      initiateTab.classList.toggle('hidden', tabName !== 'initiate');
      joinTab.classList.toggle('hidden', tabName !== 'join');
    });
  });

  // Initiate flow
  const generateBtn = container.querySelector('#generate-offer') as HTMLButtonElement;
  const offerOutput = container.querySelector('#offer-output') as HTMLTextAreaElement;
  const copyOfferBtn = container.querySelector('#copy-offer') as HTMLButtonElement;
  const answerInput = container.querySelector('#answer-input') as HTMLTextAreaElement;
  const acceptAnswerBtn = container.querySelector('#accept-answer') as HTMLButtonElement;

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    try {
      const offer = await mesh.createOffer();
      offerOutput.value = offer;
      copyOfferBtn.disabled = false;
      acceptAnswerBtn.disabled = false;
    } catch (e) {
      offerOutput.value = `Error: ${e}`;
    }

    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Invite';
  });

  copyOfferBtn.addEventListener('click', async () => {
    await copyToClipboard(offerOutput.value);
    copyOfferBtn.textContent = 'Copied!';
    setTimeout(() => (copyOfferBtn.textContent = 'Copy to Clipboard'), 2000);
  });

  acceptAnswerBtn.addEventListener('click', async () => {
    const answer = answerInput.value.trim();
    if (!answer) return;

    try {
      await mesh.acceptAnswer(answer);
      // mesh.onChange will trigger re-render when connected
    } catch (e) {
      alert(`Failed to connect: ${e}`);
    }
  });

  // Join flow
  const offerInput = container.querySelector('#offer-input') as HTMLTextAreaElement;
  const acceptOfferBtn = container.querySelector('#accept-offer') as HTMLButtonElement;
  const answerOutput = container.querySelector('#answer-output') as HTMLTextAreaElement;
  const copyAnswerBtn = container.querySelector('#copy-answer') as HTMLButtonElement;

  acceptOfferBtn.addEventListener('click', async () => {
    const offer = offerInput.value.trim();
    if (!offer) return;

    acceptOfferBtn.disabled = true;
    acceptOfferBtn.textContent = 'Processing...';

    try {
      const answer = await mesh.acceptOffer(offer);
      answerOutput.value = answer;
      copyAnswerBtn.disabled = false;
      // Don't call onComplete() here - let the user copy the answer first
      // The mesh.onChange listener will handle the re-render when connected
    } catch (e) {
      answerOutput.value = `Error: ${e}`;
    }

    acceptOfferBtn.disabled = false;
    acceptOfferBtn.textContent = 'Accept Invite';
  });

  copyAnswerBtn.addEventListener('click', async () => {
    await copyToClipboard(answerOutput.value);
    copyAnswerBtn.textContent = 'Copied!';
    setTimeout(() => (copyAnswerBtn.textContent = 'Copy to Clipboard'), 2000);
  });
}
