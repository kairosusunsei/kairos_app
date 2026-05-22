import React, { useState } from 'react';

export default function PricingPlanSelector({ currentLocale = 'ja' }) {
  const [selectedPlan, setSelectedPlan] = useState('single');
  const plans = {
    ja: [
      {
        id: 'single',
        name: '1回都度決済',
        price: '¥300',
        description: '必要な時に、その都度1回の行動分析解析を実行します。',
        badge: '基本プラン',
      },
      {
        id: 'bundle',
        name: '5回一括セット券',
        price: '¥1,000',
        description:
          '1回都度決済（300円）を5回ご利用いただく場合に比べ、一括でご購入いただくことで500円分お安くご利用いただけます。',
        badge: 'セット割引（¥500得）',
      },
      {
        id: 'subscription',
        name: '月額自動更新プラン',
        price: '¥2,000 / 月',
        description:
          '【完全使い放題】回数制限を一切気にせず、無制限にいつでも解析解禁が可能です。世界中の日常にシンクロニシティを。',
        badge: '無制限使い放題',
      },
    ],
  };
  const currentPlans = plans[currentLocale] || plans['ja'];
  const handleCheckout = () => {
    window.location.href = `/api/checkout?plan=${selectedPlan}&locale=${currentLocale}`;
  };
  return (
    <div className="w-full max-w-4xl mx-auto py-8 px-4 bg-black text-white">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold tracking-wider text-[#9B773D]">
          {currentLocale === 'ja' ? '解析プランの選択' : 'Select Plan'}
        </h2>
        <p className="text-xs text-gray-500 mt-2">
          {currentLocale === 'ja'
            ? '※景品表示法に厳格に適合した適正な表記を行っております。'
            : 'Compliant with regulations.'}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {currentPlans.map((plan) => (
          <div
            key={plan.id}
            onClick={() => setSelectedPlan(plan.id)}
            className={`p-6 rounded-lg border-2 transition-all duration-300 bg-[#0d0d0d] flex flex-col justify-between cursor-pointer ${
              selectedPlan === plan.id
                ? 'border-[#9B773D] shadow-[0_0_15px_rgba(155,119,61,0.3)]'
                : 'border-gray-800 hover:border-gray-700'
            }`}
          >
            <div>
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs bg-[#1a1a1a] text-[#9B773D] px-2 py-1 rounded font-mono border border-[#9B773D]/30">
                  {plan.badge}
                </span>
                <input
                  type="radio"
                  name="pricing-plan"
                  checked={selectedPlan === plan.id}
                  onChange={() => setSelectedPlan(plan.id)}
                  className="accent-[#9B773D] h-4 w-4"
                />
              </div>
              <h3 className="text-lg font-bold text-gray-200 mb-2">{plan.name}</h3>
              <div className="text-2xl font-mono font-bold text-white mb-4">{plan.price}</div>
              <p className="text-xs text-gray-400 leading-relaxed">{plan.description}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="max-w-xs mx-auto">
        <button
          onClick={handleCheckout}
          className="w-full py-3 bg-[#9B773D] text-black font-bold text-sm tracking-widest rounded shadow-lg hover:bg-[#b08b4e] transition-colors"
        >
          {currentLocale === 'ja' ? '選択したプランで決済に進む' : 'Proceed to Checkout'}
        </button>
      </div>
    </div>
  );
}
